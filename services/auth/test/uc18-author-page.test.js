// =========================================================
// UC18 — public author page and follow: domain rules (User, avatar URL), the use cases with
// in-memory fakes (no DB), and the HTTP routes with a stand-in for verifyJwt.
// Design: docs/02-design/uc18-author-page.md.
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { User } from '../src/domain/entities/user.js';
import { isValidAvatarUrl } from '../src/domain/value-objects/avatar-url.js';
import {
  GetAuthorProfile,
  GetFollowState,
  FollowAuthor,
  UnfollowAuthor,
  ListFollowing,
  GetMyProfile,
  UpdateMyProfile,
} from '../src/application/use-cases/author-page.js';
import { updateProfileSchema, followingQuerySchema } from '../src/application/dtos/schemas.js';
import { AuthController } from '../src/interfaces/http/controllers/auth-controller.js';
import { AuthorController } from '../src/interfaces/http/controllers/author-controller.js';
import { buildAuthRouter } from '../src/interfaces/http/routes/auth-routes.js';

// Shared middleware: repo layout (CI) first, then the image layout (/app/shared).
async function loadShared(sub) {
  let lastErr;
  for (const rel of [`../../../shared/${sub}/index.js`, `../shared/${sub}/index.js`]) {
    const url = new URL(rel, import.meta.url);
    try {
      return await import(url.href);
    } catch (err) {
      const missing = err?.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes(`'${fileURLToPath(url)}'`);
      if (!missing) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}
const { errorHandler } = await loadShared('middleware');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-03T03:00:00Z');

// ---------- Fakes ----------
class FakeUserRepo {
  constructor(users) {
    this.rows = new Map(users.map((u) => [u.id, { status: 'active', bio: null, avatarUrl: null, ...u }]));
  }
  async findById(id) {
    const row = this.rows.get(id);
    return row ? new User({ ...row }) : null;
  }
  async updateProfile(id, fields) {
    const row = this.rows.get(id);
    if (!row) return null;
    for (const k of ['fullName', 'bio', 'avatarUrl']) if (fields[k] !== undefined) row[k] = fields[k];
    return new User({ ...row });
  }
}

// Same semantics as PrismaFollowRepository: unique pair, active contributors in the list.
class FakeFollowRepo {
  constructor(userRepo) {
    this.userRepo = userRepo;
    this.rows = []; // { followerId, authorId, createdAt }
    this.clock = 0;
  }
  async follow(followerId, authorId) {
    await new Promise((r) => setImmediate(r)); // let concurrent callers interleave
    if (this.rows.some((r) => r.followerId === followerId && r.authorId === authorId)) return;
    this.rows.push({ followerId, authorId, createdAt: new Date(NOW.getTime() + ++this.clock * 1000) });
  }
  async unfollow(followerId, authorId) {
    this.rows = this.rows.filter((r) => !(r.followerId === followerId && r.authorId === authorId));
  }
  async isFollowing(followerId, authorId) {
    return this.rows.some((r) => r.followerId === followerId && r.authorId === authorId);
  }
  async countFollowers(authorId) {
    return this.rows.filter((r) => r.authorId === authorId).length;
  }
  async countFollowersMany(ids) {
    return new Map(ids.map((id) => [id, this.rows.filter((r) => r.authorId === id).length]));
  }
  async listFollowing({ followerId, skip, take, now }) {
    const mine = [];
    for (const r of this.rows.filter((x) => x.followerId === followerId)) {
      const author = await this.userRepo.findById(r.authorId);
      if (author?.isFollowableAuthor(now)) mine.push({ author, followedAt: r.createdAt });
    }
    mine.sort((a, b) => b.followedAt - a.followedAt);
    return { items: mine.slice(skip, skip + take), total: mine.length };
  }
}

function world() {
  const userRepo = new FakeUserRepo([
    { id: 'c1', email: 'an@mail.com', passwordHash: 'h', fullName: 'Nguyễn An', role: 'contributor', bio: 'Hướng dẫn viên Hội An', createdAt: new Date('2026-01-01T00:00:00Z') },
    { id: 'c2', email: 'binh@mail.com', passwordHash: 'h', fullName: 'Trần Bình', role: 'contributor', createdAt: new Date('2026-02-01T00:00:00Z') },
    { id: 'c3', email: 'cuong@mail.com', passwordHash: 'h', fullName: 'Lê Cường', role: 'contributor', createdAt: new Date('2026-03-01T00:00:00Z') },
    { id: 'banned', email: 'x@mail.com', passwordHash: 'h', fullName: 'Bị cấm', role: 'contributor', status: 'banned' },
    { id: 'susp', email: 's@mail.com', passwordHash: 'h', fullName: 'Tạm khoá', role: 'contributor', status: 'suspended', suspendedUntil: new Date(NOW.getTime() + DAY) },
    { id: 'susp-ended', email: 'e@mail.com', passwordHash: 'h', fullName: 'Hết khoá', role: 'contributor', status: 'suspended', suspendedUntil: new Date(NOW.getTime() - DAY) },
    { id: 't1', email: 't1@mail.com', passwordHash: 'h', fullName: 'Khách 1', role: 'tourist' },
    { id: 'admin1', email: 'ad@mail.com', passwordHash: 'h', fullName: 'Admin', role: 'admin' },
  ]);
  const followRepo = new FakeFollowRepo(userRepo);
  const deps = { userRepo, followRepo, now: () => NOW };
  return {
    userRepo,
    followRepo,
    profile: new GetAuthorProfile(deps),
    state: new GetFollowState(deps),
    follow: new FollowAuthor(deps),
    unfollow: new UnfollowAuthor(deps),
    following: new ListFollowing(deps),
    me: new GetMyProfile(deps),
    update: new UpdateMyProfile(deps),
  };
}

// ---------- Domain ----------
test('avatar URL: https or the Media image path, nothing else', () => {
  for (const ok of [
    'https://cdn.example.com/a.png',
    'https://res.cloudinary.com/x/image/upload/v1/a.webp',
    'http://localhost:8080/api/media/files/images/2026/11/a.jpg',
    'https://abc.ngrok-free.app/api/media/files/images/a.png',
    '/api/media/files/images/a.png',
  ]) assert.equal(isValidAvatarUrl(ok), true, ok);
  for (const bad of [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:image/png;base64,AAAA',
    'http://evil.com/a.png',
    'http://localhost:8080/api/media/files/audio/a.mp3',
    'http://localhost:8080/api/media/files/images/',
    '/api/media/files/images/../../secret',
    '/api/media/files/images/%2e%2e/x',
    '//evil.com/api/media/files/images/a.png',
    '/other/a.png',
    'ftp://host/a.png',
    'https://user:pw@host/a.png',
    'https://host/a b.png',
    'https:\\\\host\\a.png',
    'a.png',
    '',
    'https://h/' + 'a'.repeat(500),
    42,
    null,
  ]) assert.equal(isValidAvatarUrl(bad), false, String(bad));
});

test('User: only an active contributor is followable; the author profile never has the email', () => {
  const base = { email: 'a@b.c', passwordHash: 'h', fullName: 'A' };
  assert.equal(new User({ ...base, role: 'contributor' }).isFollowableAuthor(NOW), true);
  assert.equal(new User({ ...base, role: 'tourist' }).isFollowableAuthor(NOW), false);
  assert.equal(new User({ ...base, role: 'admin' }).isFollowableAuthor(NOW), false);
  assert.equal(new User({ ...base, role: 'contributor', status: 'banned' }).isFollowableAuthor(NOW), false);
  assert.equal(new User({ ...base, role: 'contributor', status: 'suspended', suspendedUntil: new Date(NOW.getTime() + DAY) }).isFollowableAuthor(NOW), false);
  assert.equal(new User({ ...base, role: 'contributor', status: 'suspended', suspendedUntil: new Date(NOW.getTime() - DAY) }).isFollowableAuthor(NOW), true);
  const p = new User({ ...base, id: 'c1', role: 'contributor', bio: 'Hi', createdAt: NOW }).toAuthorProfile(3);
  assert.deepEqual(Object.keys(p).sort(), ['avatarUrl', 'bio', 'followerCount', 'fullName', 'id', 'joinedAt']);
  assert.equal(p.followerCount, 3);
});

// ---------- Use cases ----------
test('GetAuthorProfile: active contributor only, 404 author_not_found otherwise', async () => {
  const w = world();
  const p = await w.profile.execute({ authorId: 'c1' });
  assert.deepEqual(p, { id: 'c1', fullName: 'Nguyễn An', avatarUrl: null, bio: 'Hướng dẫn viên Hội An', followerCount: 0, joinedAt: new Date('2026-01-01T00:00:00Z') });
  assert.equal('email' in p, false);
  assert.equal((await w.profile.execute({ authorId: 'susp-ended' })).id, 'susp-ended');
  for (const id of ['ghost', 't1', 'admin1', 'banned', 'susp', '', undefined]) {
    await assert.rejects(w.profile.execute({ authorId: id }), (e) => e.status === 404 && e.code === 'author_not_found', String(id));
  }
});

test('FollowAuthor: idempotent, concurrent follows keep one row, counts follow', async () => {
  const w = world();
  assert.deepEqual(await w.follow.execute({ userId: 't1', authorId: 'c1' }), { following: true, followerCount: 1 });
  assert.deepEqual(await w.follow.execute({ userId: 't1', authorId: 'c1' }), { following: true, followerCount: 1 });
  await Promise.all(Array.from({ length: 5 }, () => w.follow.execute({ userId: 'c2', authorId: 'c1' })));
  assert.equal(w.followRepo.rows.length, 2);
  assert.deepEqual(await w.state.execute({ userId: 't1', authorId: 'c1' }), { following: true, followerCount: 2 });
  assert.deepEqual(await w.state.execute({ userId: 'admin1', authorId: 'c1' }), { following: false, followerCount: 2 });
  assert.equal((await w.profile.execute({ authorId: 'c1' })).followerCount, 2);
});

test('FollowAuthor: never yourself (400 self_follow), never a non-contributor or restricted account (404)', async () => {
  const w = world();
  await assert.rejects(w.follow.execute({ userId: 'c1', authorId: 'c1' }), (e) => e.status === 400 && e.code === 'self_follow');
  for (const id of ['t1', 'admin1', 'banned', 'susp', 'ghost']) {
    await assert.rejects(w.follow.execute({ userId: 'c2', authorId: id }), (e) => e.status === 404 && e.code === 'author_not_found', id);
  }
  await assert.rejects(w.state.execute({ userId: 'c2', authorId: 'banned' }), (e) => e.code === 'author_not_found');
  assert.equal(w.followRepo.rows.length, 0);
  // Own page: state is "not following", never an error.
  assert.deepEqual(await w.state.execute({ userId: 'c1', authorId: 'c1' }), { following: false, followerCount: 0 });
});

test('UnfollowAuthor: idempotent and allowed even when the author lost the page', async () => {
  const w = world();
  await w.follow.execute({ userId: 't1', authorId: 'c1' });
  assert.deepEqual(await w.unfollow.execute({ userId: 't1', authorId: 'c1' }), { following: false, followerCount: 0 });
  assert.deepEqual(await w.unfollow.execute({ userId: 't1', authorId: 'c1' }), { following: false, followerCount: 0 });
  w.followRepo.rows.push({ followerId: 't1', authorId: 'banned', createdAt: NOW }); // followed before the ban
  assert.deepEqual(await w.unfollow.execute({ userId: 't1', authorId: 'banned' }), { following: false, followerCount: 0 });
});

test('ListFollowing: newest follow first, paged, restricted authors hidden', async () => {
  const w = world();
  await w.follow.execute({ userId: 't1', authorId: 'c1' });
  await w.follow.execute({ userId: 't1', authorId: 'c2' });
  await w.follow.execute({ userId: 't1', authorId: 'c3' });
  await w.follow.execute({ userId: 'c2', authorId: 'c3' });
  w.followRepo.rows.push({ followerId: 't1', authorId: 'banned', createdAt: new Date(NOW.getTime() + DAY) });

  const first = await w.following.execute({ userId: 't1', page: 1, limit: 2 });
  assert.equal(first.total, 3);
  assert.deepEqual(first.items.map((a) => a.id), ['c3', 'c2']);
  assert.equal(first.items[0].followerCount, 2);
  assert.ok(first.items[0].followedAt instanceof Date);
  assert.equal('email' in first.items[0], false);
  const second = await w.following.execute({ userId: 't1', page: 2, limit: 2 });
  assert.deepEqual(second.items.map((a) => a.id), ['c1']);
  assert.deepEqual([second.page, second.limit], [2, 2]);
  assert.equal((await w.following.execute({ userId: 'nobody' })).total, 0);
  assert.equal((await w.following.execute({ userId: 't1', limit: 500 })).limit, 50);
});

test('UpdateMyProfile: trims, clears with null, checks the avatar, any role, returns email', async () => {
  const w = world();
  const r = await w.update.execute({ userId: 't1', fullName: '  Khách Mới  ', bio: '  Thích đi bộ ', avatarUrl: '/api/media/files/images/a.png' });
  assert.deepEqual(r, {
    id: 't1', fullName: 'Khách Mới', avatarUrl: '/api/media/files/images/a.png', bio: 'Thích đi bộ',
    followerCount: 0, joinedAt: null, email: 't1@mail.com', role: 'tourist',
  });
  const cleared = await w.update.execute({ userId: 't1', bio: null, avatarUrl: '' });
  assert.deepEqual([cleared.bio, cleared.avatarUrl, cleared.fullName], [null, null, 'Khách Mới']);
  await assert.rejects(w.update.execute({ userId: 't1', avatarUrl: 'javascript:alert(1)' }), (e) => e.code === 'validation_error');
  await assert.rejects(w.update.execute({ userId: 't1', bio: 'x'.repeat(501) }), (e) => e.code === 'validation_error');
  await assert.rejects(w.update.execute({ userId: 't1', fullName: '   ' }), (e) => e.code === 'validation_error');
  await assert.rejects(w.update.execute({ userId: 't1' }), (e) => e.code === 'validation_error');
  await assert.rejects(w.update.execute({ userId: 'ghost', bio: 'x' }), (e) => e.status === 404);
});

test('DTOs: profile body needs one field, null / blank clear, bad URL refused; following query bounded', () => {
  assert.equal(updateProfileSchema.safeParse({}).success, false);
  assert.equal(updateProfileSchema.safeParse({ email: 'x@y.z' }).success, false); // unknown keys stripped -> nothing left
  assert.deepEqual(updateProfileSchema.parse({ bio: null, avatarUrl: '  ' }), { bio: null, avatarUrl: null });
  assert.deepEqual(updateProfileSchema.parse({ fullName: ' An ' }), { fullName: 'An' });
  assert.equal(updateProfileSchema.safeParse({ fullName: 'x'.repeat(121) }).success, false);
  assert.equal(updateProfileSchema.safeParse({ fullName: null }).success, false);
  assert.equal(updateProfileSchema.safeParse({ bio: 'x'.repeat(501) }).success, false);
  assert.equal(updateProfileSchema.safeParse({ avatarUrl: 'data:image/png;base64,AA' }).success, false);
  assert.equal(updateProfileSchema.safeParse({ avatarUrl: 5 }).success, false);
  assert.deepEqual(followingQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.equal(followingQuerySchema.safeParse({ limit: '51' }).success, false);
});

// ---------- HTTP ----------
async function withServer(w, fn) {
  const authorController = new AuthorController({
    getAuthorProfile: w.profile, getFollowState: w.state, followAuthor: w.follow,
    unfollowAuthor: w.unfollow, listFollowing: w.following, getMyProfile: w.me, updateMyProfile: w.update,
  });
  // Stand-in for shared verifyJwt(roles): "Bearer <userId>:<role>".
  const guard = (roles = []) => (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const [sub, role] = h.slice(7).split(':');
    if (roles.length && !roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    req.user = { sub, role };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/', buildAuthRouter({ authController: new AuthController({}), authorController, requireAuth: guard(), requireAdmin: guard(['admin']) }));
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { as, body } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (as) headers.authorization = `Bearer ${as}`;
    const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const origError = console.error;
  console.error = () => {}; // the shared errorHandler logs every error
  try {
    await fn(call);
  } finally {
    console.error = origError;
    await new Promise((r) => server.close(r));
  }
}

test('HTTP: author page is public; follow routes need sign-in', async () => {
  const w = world();
  await withServer(w, async (call) => {
    const page = await call('GET', '/authors/c1');
    assert.equal(page.status, 200);
    assert.equal(page.body.fullName, 'Nguyễn An');
    assert.equal(page.body.email, undefined);
    const missing = await call('GET', '/authors/t1');
    assert.deepEqual([missing.status, missing.body.code, missing.body.error], [404, 'author_not_found', 'Không tìm thấy tác giả']);

    assert.equal((await call('GET', '/authors/c1/follow')).status, 401);
    assert.equal((await call('PUT', '/authors/c1/follow')).status, 401);
    assert.equal((await call('DELETE', '/authors/c1/follow')).status, 401);
    assert.equal((await call('GET', '/me/following')).status, 401);
    assert.equal((await call('GET', '/me/profile')).status, 401);
    assert.equal((await call('PATCH', '/me/profile', { body: { bio: 'x' } })).status, 401);
  });
});

test('HTTP: follow, state, unfollow, self follow, list, profile update', async () => {
  const w = world();
  await withServer(w, async (call) => {
    const me = 't1:tourist';
    assert.deepEqual((await call('PUT', '/authors/c1/follow', { as: me })).body, { following: true, followerCount: 1 });
    assert.deepEqual((await call('PUT', '/authors/c1/follow', { as: me })).body, { following: true, followerCount: 1 });
    assert.deepEqual((await call('GET', '/authors/c1/follow', { as: me })).body, { following: true, followerCount: 1 });
    const self = await call('PUT', '/authors/c1/follow', { as: 'c1:contributor' });
    assert.deepEqual([self.status, self.body.code], [400, 'self_follow']);
    const banned = await call('PUT', '/authors/banned/follow', { as: me });
    assert.deepEqual([banned.status, banned.body.code], [404, 'author_not_found']);

    const list = await call('GET', '/me/following?page=1&limit=10', { as: me });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((a) => a.id), ['c1']);
    assert.equal(list.body.items[0].email, undefined);
    assert.equal((await call('GET', '/me/following?limit=0', { as: me })).status, 400);

    assert.deepEqual((await call('DELETE', '/authors/c1/follow', { as: me })).body, { following: false, followerCount: 0 });
    assert.deepEqual((await call('DELETE', '/authors/c1/follow', { as: me })).body, { following: false, followerCount: 0 });

    const upd = await call('PATCH', '/me/profile', { as: 'c1:contributor', body: { bio: '  Mới  ', avatarUrl: 'https://cdn.example.com/a.png' } });
    assert.equal(upd.status, 200);
    assert.deepEqual([upd.body.bio, upd.body.avatarUrl, upd.body.email], ['Mới', 'https://cdn.example.com/a.png', 'an@mail.com']);
    assert.equal((await call('GET', '/authors/c1')).body.bio, 'Mới');
    for (const body of [{}, { avatarUrl: 'javascript:alert(1)' }, { bio: 'x'.repeat(501) }, { fullName: '' }]) {
      const bad = await call('PATCH', '/me/profile', { as: 'c1:contributor', body });
      assert.deepEqual([bad.status, bad.body.code], [400, 'validation_error'], JSON.stringify(body));
    }
  });
});

test('GetMyProfile (#298): own profile for any role, with email and role; 404 user_not_found when gone', async () => {
  const w = world();
  assert.deepEqual(await w.me.execute({ userId: 'c1' }), {
    id: 'c1', email: 'an@mail.com', fullName: 'Nguyễn An', role: 'contributor', bio: 'Hướng dẫn viên Hội An', avatarUrl: null,
  });
  assert.deepEqual(await w.me.execute({ userId: 't1' }), {
    id: 't1', email: 't1@mail.com', fullName: 'Khách 1', role: 'tourist', bio: null, avatarUrl: null,
  });
  assert.equal((await w.me.execute({ userId: 'admin1' })).role, 'admin');
  // Not an author page: a restricted account still reads its own profile.
  assert.equal((await w.me.execute({ userId: 'banned' })).id, 'banned');
  for (const id of ['ghost', '', undefined]) {
    await assert.rejects(w.me.execute({ userId: id }), (e) => e.status === 404 && e.code === 'user_not_found', String(id));
  }
});

test('HTTP: GET /me/profile returns the caller profile and reflects PATCH; 404 when the account is gone', async () => {
  const w = world();
  await withServer(w, async (call) => {
    const admin = await call('GET', '/me/profile', { as: 'admin1:admin' });
    assert.equal(admin.status, 200);
    assert.deepEqual(Object.keys(admin.body).sort(), ['avatarUrl', 'bio', 'email', 'fullName', 'id', 'role']);
    assert.deepEqual([admin.body.email, admin.body.role, admin.body.bio], ['ad@mail.com', 'admin', null]);
    assert.equal(admin.body.passwordHash, undefined);

    await call('PATCH', '/me/profile', { as: 't1:tourist', body: { bio: 'Thích đi bộ', avatarUrl: '/api/media/files/images/a.png' } });
    const tourist = await call('GET', '/me/profile', { as: 't1:tourist' });
    assert.deepEqual([tourist.status, tourist.body.bio, tourist.body.avatarUrl], [200, 'Thích đi bộ', '/api/media/files/images/a.png']);

    const gone = await call('GET', '/me/profile', { as: 'ghost:tourist' });
    assert.deepEqual([gone.status, gone.body.code], [404, 'user_not_found']);
  });
});
