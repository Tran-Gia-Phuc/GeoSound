// =========================================================
// UC21 — admin account actions: domain rules of User, the use cases with in-memory fakes (no DB,
// Redis or broker), sign-in / refresh of a suspended account, and the HTTP routes with a stand-in
// for verifyJwt(roles). The published payloads are checked with the shared zod contract.
// Design: docs/02-design/uc21-account-actions.md.
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { User, USER_STATUS } from '../src/domain/entities/user.js';
import { Session } from '../src/domain/entities/session.js';
import { AccountSuspendedError, formatVietnamTime } from '../src/domain/errors/index.js';
import { SessionManager } from '../src/application/services/session-manager.js';
import { RevokeAllSessions } from '../src/application/use-cases/revoke-all-sessions.js';
import { Login } from '../src/application/use-cases/login.js';
import { RefreshToken } from '../src/application/use-cases/refresh-token.js';
import { SearchUsers, GetUserForAdmin } from '../src/application/use-cases/admin-users.js';
import {
  WarnUser,
  SuspendUser,
  BanUser,
  RestoreUser,
  suspensionEnd,
  ACCOUNT_MODERATED_EVENT,
} from '../src/application/use-cases/account-actions.js';
import { AuthController } from '../src/interfaces/http/controllers/auth-controller.js';
import { AdminUsersController } from '../src/interfaces/http/controllers/admin-users-controller.js';
import { buildAuthRouter } from '../src/interfaces/http/routes/auth-routes.js';

// Shared contract: repo layout (CI) first, then the image layout (/app/shared).
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
const { validateEvent, EVENTS } = await loadShared('events');
const { errorHandler } = await loadShared('middleware');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-03T03:00:00Z');
const silent = { log() {}, warn() {}, error() {} };

// ---------- Fakes ----------
// Rows are plain objects; every read returns a fresh User (like Prisma), so concurrent use cases do
// not share one object and the conditional write really decides.
class FakeUserRepo {
  constructor(users) {
    // Same defaults as the table: status active, no reason, no end date.
    this.rows = new Map(users.map((u) => [u.id, { status: 'active', banReason: null, suspendedUntil: null, ...u }]));
    this.writes = 0;
  }
  async findById(id) {
    const row = this.rows.get(id);
    return row ? new User({ ...row }) : null;
  }
  async findByEmail(email) {
    const row = [...this.rows.values()].find((r) => r.email === email);
    return row ? new User({ ...row }) : null;
  }
  async save(user) {
    const row = this.rows.get(user.id);
    // Same columns as PrismaUserRepository.save: never the UC21 status.
    Object.assign(row, {
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      role: user.role,
      failedAttempts: user.failedAttempts,
      lockedUntil: user.lockedUntil,
    });
    return new User({ ...row });
  }
  async search({ q, role, status, skip, take, now }) {
    let list = [...this.rows.values()].map((r) => new User({ ...r }));
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((u) => u.email.toLowerCase().includes(needle) || u.fullName.toLowerCase().includes(needle));
    }
    if (role) list = list.filter((u) => u.role === role);
    if (status) list = list.filter((u) => u.effectiveStatus(now) === status);
    list.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    return { items: list.slice(skip, skip + take), total: list.length };
  }
  async updateStatusIf(id, expected, next) {
    await new Promise((r) => setImmediate(r)); // let concurrent callers interleave
    const row = this.rows.get(id);
    const same = (a, b) => (a?.getTime?.() ?? a ?? null) === (b?.getTime?.() ?? b ?? null);
    if (!row || row.status !== expected.status || !same(row.suspendedUntil, expected.suspendedUntil)) return false;
    Object.assign(row, next);
    this.writes += 1;
    return true;
  }
}

class FakeSessionRepo {
  constructor(sessions = []) {
    this.rows = new Map(sessions.map((s) => [s.id, s]));
  }
  async create(s) {
    this.rows.set(s.id, s);
    return s;
  }
  async save(s) {
    this.rows.set(s.id, s);
    return s;
  }
  async findById(id) {
    return this.rows.get(id) ?? null;
  }
  async findLatestByDevice() {
    return null;
  }
  async listActiveByUser(userId, now) {
    return [...this.rows.values()].filter((s) => s.userId === userId && s.isActive(now));
  }
}

// Publisher that validates every payload against the shared contract (like shared publish()).
class ValidatingPublisher {
  constructor() {
    this.events = [];
    this.fail = false;
  }
  async publish(name, payload) {
    validateEvent(name, payload);
    if (this.fail) throw new Error('broker down');
    this.events.push({ name, payload });
  }
}

const fakeTokens = {
  issueTokens: (u, { sid } = {}) => ({ accessToken: `at:${u.id}:${sid}`, refreshToken: `rt:${u.id}:${sid}`, expiresIn: '15m' }),
  verifyRefresh: (t) => {
    const [kind, sub, sid] = String(t).split(':');
    if (kind !== 'rt') throw new Error('bad');
    return { sub, sid };
  },
  hashRefresh: (t) => `hash(${t})`,
};

function session(id, userId) {
  return new Session({
    id,
    userId,
    deviceId: `dev-${id}`,
    deviceName: 'Chrome trên Windows',
    refreshHash: `hash(rt:${userId}:${id})`,
    createdAt: new Date(NOW.getTime() - DAY),
    lastActiveAt: NOW,
    expiresAt: new Date(NOW.getTime() + DAY),
  });
}

const PEOPLE = [
  { id: 'admin1', email: 'admin@geo.vn', fullName: 'Quản trị', role: 'admin', passwordHash: 'h:pw', createdAt: new Date('2026-01-01T00:00:00Z') },
  { id: 'admin2', email: 'admin2@geo.vn', fullName: 'Quản trị 2', role: 'admin', passwordHash: 'h:pw', createdAt: new Date('2026-01-02T00:00:00Z') },
  { id: 'u1', email: 'an@mail.com', fullName: 'Nguyễn An', role: 'contributor', passwordHash: 'h:pw', createdAt: new Date('2026-02-01T00:00:00Z') },
  { id: 'u2', email: 'binh@mail.com', fullName: 'Trần Bình', role: 'tourist', passwordHash: 'h:pw', createdAt: new Date('2026-03-01T00:00:00Z') },
  {
    id: 'u3', email: 'chi@mail.com', fullName: 'Lê Chi', role: 'contributor', passwordHash: 'h:pw', createdAt: new Date('2026-04-01T00:00:00Z'),
    status: 'suspended', banReason: 'Spam', suspendedUntil: new Date(NOW.getTime() + 3 * DAY),
  },
  {
    id: 'u4', email: 'dung@mail.com', fullName: 'Phạm Dũng', role: 'contributor', passwordHash: 'h:pw', createdAt: new Date('2026-05-01T00:00:00Z'),
    status: 'suspended', banReason: 'Cũ', suspendedUntil: new Date(NOW.getTime() - DAY), // ended: reads active
  },
  {
    id: 'u5', email: 'em@mail.com', fullName: 'Võ Em', role: 'tourist', passwordHash: 'h:pw', createdAt: new Date('2026-06-01T00:00:00Z'),
    status: 'banned', banReason: 'Lừa đảo',
  },
];

function world({ sessions = [session('s1', 'u1'), session('s2', 'u1'), session('s3', 'u2')] } = {}) {
  const userRepo = new FakeUserRepo(PEOPLE);
  const sessionRepo = new FakeSessionRepo(sessions);
  const revocations = { marked: [], async markRevoked(sid) { this.marked.push(sid); } };
  const sessions_ = new SessionManager({
    sessionRepo, tokens: fakeTokens, revocations, policy: { idleDays: 7, maxDays: 30, maxSessions: 100 }, now: () => NOW, logger: silent,
  });
  const publisher = new ValidatingPublisher();
  const deps = { userRepo, revokeAllSessions: new RevokeAllSessions({ sessions: sessions_ }), publisher, now: () => NOW, logger: silent };
  return {
    userRepo, sessionRepo, revocations, publisher, sessions: sessions_,
    warn: new WarnUser(deps), suspend: new SuspendUser(deps), ban: new BanUser(deps), restore: new RestoreUser(deps),
    search: new SearchUsers({ userRepo, now: () => NOW }),
    detail: new GetUserForAdmin({ userRepo, sessionRepo, now: () => NOW }),
  };
}

const rejectsWith = (p, status, code) => assert.rejects(p, (e) => e.status === status && e.code === code);

// ---------- Domain ----------
test('User: suspension reads active once its end passed; admin view hides secrets', () => {
  const u = new User({ ...PEOPLE[4] });
  assert.equal(u.isSuspended(NOW), true);
  assert.equal(u.effectiveStatus(NOW), USER_STATUS.SUSPENDED);
  assert.equal(u.isRestricted(NOW), true);
  assert.equal(u.effectiveStatus(new Date(NOW.getTime() + 4 * DAY)), USER_STATUS.ACTIVE);

  const ended = new User({ ...PEOPLE[5], failedAttempts: 3, lockedUntil: NOW });
  assert.equal(ended.isSuspended(NOW), false);
  assert.equal(ended.isRestricted(NOW), false);
  const view = ended.toAdminView(NOW);
  assert.deepEqual(Object.keys(view).sort(), ['banReason', 'createdAt', 'email', 'fullName', 'id', 'role', 'status', 'suspendedUntil']);
  assert.equal(view.status, 'active');
  assert.equal(view.banReason, null);
  assert.equal(view.suspendedUntil, null);
  assert.equal(new User({ ...PEOPLE[6] }).effectiveStatus(NOW), USER_STATUS.BANNED);
});

test('suspension end: presets 1 / 7 / 30 days, or an end date in the future within 365 days', () => {
  assert.equal(suspensionEnd({ days: 7 }, NOW).getTime(), NOW.getTime() + 7 * DAY);
  assert.equal(suspensionEnd({ until: '2026-12-01T00:00:00+07:00' }, NOW).toISOString(), '2026-11-30T17:00:00.000Z');
  assert.throws(() => suspensionEnd({ days: 3 }, NOW), (e) => e.status === 422);
  assert.throws(() => suspensionEnd({ until: '2026-11-01T00:00:00Z' }, NOW), (e) => e.status === 422);
  assert.throws(() => suspensionEnd({ until: new Date(NOW.getTime() + 366 * DAY).toISOString() }, NOW), (e) => e.status === 422);
  assert.ok(suspensionEnd({ until: new Date(NOW.getTime() + 365 * DAY).toISOString() }, NOW));
  assert.throws(() => suspensionEnd({}, NOW), (e) => e.status === 422);
});

// ---------- Search / detail ----------
test('search: email or name contains (case-insensitive), role and effective status filters, paged newest first', async () => {
  const w = world();
  const all = await w.search.execute({});
  assert.equal(all.total, 7);
  assert.deepEqual(all.items.map((u) => u.id), ['u5', 'u4', 'u3', 'u2', 'u1', 'admin2', 'admin1']);
  assert.equal(all.limit, 20);
  assert.doesNotMatch(JSON.stringify(all), /passwordHash|h:pw|failedAttempts|lockedUntil/);

  assert.deepEqual((await w.search.execute({ q: 'MAIL.COM', role: 'contributor' })).items.map((u) => u.id), ['u4', 'u3', 'u1']);
  assert.deepEqual((await w.search.execute({ q: 'bình' })).items.map((u) => u.id), ['u2']);
  assert.deepEqual((await w.search.execute({ status: 'suspended' })).items.map((u) => u.id), ['u3']);
  assert.deepEqual((await w.search.execute({ status: 'banned' })).items.map((u) => u.id), ['u5']);
  assert.ok((await w.search.execute({ status: 'active' })).items.some((u) => u.id === 'u4'));

  const page2 = await w.search.execute({ page: 2, limit: 3 });
  assert.deepEqual(page2.items.map((u) => u.id), ['u2', 'u1', 'admin2']);
  assert.equal(page2.total, 7);
  assert.equal((await w.search.execute({ limit: 500 })).limit, 50);
});

test('detail: fields + active session count; unknown account -> 404 user_not_found (E1)', async () => {
  const w = world();
  const d = await w.detail.execute({ userId: 'u1' });
  assert.equal(d.activeSessions, 2);
  assert.equal(d.status, 'active');
  assert.equal(d.passwordHash, undefined);
  await assert.rejects(w.detail.execute({ userId: 'nope' }), (e) => e.status === 404 && e.code === 'user_not_found' && e.message === 'Không tìm thấy tài khoản');
});

// ---------- Actions ----------
test('warn: no status change, event published; refused for a banned account', async () => {
  const w = world();
  const res = await w.warn.execute({ userId: 'u1', adminId: 'admin1', reason: 'Spam nhiều tour' });
  assert.equal(res.user.status, 'active');
  assert.equal(w.userRepo.writes, 0);
  assert.equal(w.sessionRepo.rows.get('s1').isRevoked(), false);
  assert.deepEqual(w.publisher.events, [{
    name: ACCOUNT_MODERATED_EVENT,
    payload: { userId: 'u1', action: 'warn', reason: 'Spam nhiều tour', adminId: 'admin1', email: 'an@mail.com', fullName: 'Nguyễn An', at: NOW.toISOString() },
  }]);
  assert.equal(ACCOUNT_MODERATED_EVENT, EVENTS.ACCOUNT_MODERATED);
  await rejectsWith(w.warn.execute({ userId: 'u5', adminId: 'admin1', reason: 'x' }), 409, 'account_already_banned');
});

test('suspend: status + end date saved, every device signed out (reason suspended), event with until', async () => {
  const w = world();
  const res = await w.suspend.execute({ userId: 'u1', adminId: 'admin1', reason: 'Nội dung sai', days: 7 });
  const until = new Date(NOW.getTime() + 7 * DAY);
  assert.equal(res.user.status, 'suspended');
  assert.equal(res.user.suspendedUntil.getTime(), until.getTime());
  assert.equal(res.sessionsRevoked, 2);
  const row = w.userRepo.rows.get('u1');
  assert.equal(row.status, 'suspended');
  assert.equal(row.banReason, 'Nội dung sai');
  for (const sid of ['s1', 's2']) assert.equal(w.sessionRepo.rows.get(sid).revokeReason, 'suspended');
  assert.equal(w.sessionRepo.rows.get('s3').isRevoked(), false); // another user's device
  assert.deepEqual(w.revocations.marked.sort(), ['s1', 's2']);
  assert.equal(w.publisher.events[0].payload.action, 'suspend');
  assert.equal(w.publisher.events[0].payload.until, until.toISOString());

  // Suspended again: the new end replaces the old one.
  const again = await w.suspend.execute({ userId: 'u1', adminId: 'admin1', reason: 'Tái phạm', until: '2026-12-31T00:00:00Z' });
  assert.equal(again.user.suspendedUntil.toISOString(), '2026-12-31T00:00:00.000Z');
  await rejectsWith(w.suspend.execute({ userId: 'u5', adminId: 'admin1', reason: 'x', days: 1 }), 409, 'account_already_banned');
  await rejectsWith(w.suspend.execute({ userId: 'u1', adminId: 'admin1', reason: 'x', days: 2 }), 422, 'validation_error');
});

test('ban: banned, every device signed out (reason banned), event published; banned twice -> 409', async () => {
  const w = world();
  const res = await w.ban.execute({ userId: 'u1', adminId: 'admin1', reason: 'Lừa đảo' });
  assert.equal(res.user.status, 'banned');
  assert.equal(res.user.banReason, 'Lừa đảo');
  assert.equal(res.sessionsRevoked, 2);
  for (const sid of ['s1', 's2']) assert.equal(w.sessionRepo.rows.get(sid).revokeReason, 'banned');
  assert.equal(w.publisher.events[0].payload.action, 'ban');
  assert.equal(w.publisher.events[0].payload.until, undefined);
  await rejectsWith(w.ban.execute({ userId: 'u1', adminId: 'admin1', reason: 'x' }), 409, 'account_already_banned');
  // A suspended account can be banned.
  assert.equal((await w.ban.execute({ userId: 'u3', adminId: 'admin1', reason: 'Tái phạm' })).user.status, 'banned');
});

test('restore: suspended or banned back to active; already active or ended suspension -> 409 account_not_restricted', async () => {
  const w = world();
  const res = await w.restore.execute({ userId: 'u5', adminId: 'admin1' });
  assert.equal(res.user.status, 'active');
  const row = w.userRepo.rows.get('u5');
  assert.deepEqual([row.status, row.banReason, row.suspendedUntil], ['active', null, null]);
  assert.deepEqual(w.publisher.events[0].payload, { userId: 'u5', action: 'restore', adminId: 'admin1', email: 'em@mail.com', fullName: 'Võ Em', at: NOW.toISOString() });

  await w.restore.execute({ userId: 'u3', adminId: 'admin1', reason: 'Đã khiếu nại' });
  assert.equal(w.publisher.events[1].payload.reason, 'Đã khiếu nại');
  await rejectsWith(w.restore.execute({ userId: 'u1', adminId: 'admin1' }), 409, 'account_not_restricted');
  await rejectsWith(w.restore.execute({ userId: 'u4', adminId: 'admin1' }), 409, 'account_not_restricted');
});

test('guards: own account -> 403 self_action, another admin -> 403 target_is_admin, unknown -> 404', async () => {
  const w = world();
  for (const uc of [w.warn, w.ban, w.restore]) {
    await rejectsWith(uc.execute({ userId: 'admin1', adminId: 'admin1', reason: 'x' }), 403, 'self_action');
    await rejectsWith(uc.execute({ userId: 'admin2', adminId: 'admin1', reason: 'x' }), 403, 'target_is_admin');
    await rejectsWith(uc.execute({ userId: 'ghost', adminId: 'admin1', reason: 'x' }), 404, 'user_not_found');
  }
  await rejectsWith(w.suspend.execute({ userId: 'admin2', adminId: 'admin1', reason: 'x', days: 1 }), 403, 'target_is_admin');
  assert.equal(w.publisher.events.length, 0);
});

test('race: two admins ban at once -> one wins, the other gets 409 account_state_changed; one event', async () => {
  const w = world();
  const results = await Promise.allSettled([
    w.ban.execute({ userId: 'u1', adminId: 'admin1', reason: 'A' }),
    w.ban.execute({ userId: 'u1', adminId: 'admin2', reason: 'B' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = results.find((r) => r.status === 'rejected');
  assert.equal(lost.reason.status, 409);
  assert.equal(lost.reason.code, 'account_state_changed');
  assert.equal(w.userRepo.writes, 1);
  assert.equal(w.publisher.events.length, 1);

  // Suspend vs restore on the same suspended account: also only one wins.
  const mixed = await Promise.allSettled([
    w.restore.execute({ userId: 'u3', adminId: 'admin1' }),
    w.suspend.execute({ userId: 'u3', adminId: 'admin2', reason: 'x', days: 30 }),
  ]);
  assert.equal(mixed.filter((r) => r.status === 'rejected' && r.reason.code === 'account_state_changed').length, 1);
});

test('a failed publish or sign-out is only logged; the action still succeeds', async () => {
  const w = world();
  w.publisher.fail = true;
  const warned = [];
  const ban = new BanUser({
    userRepo: w.userRepo,
    revokeAllSessions: { execute: async () => { throw new Error('db down'); } },
    publisher: w.publisher,
    now: () => NOW,
    logger: { ...silent, warn: (m) => warned.push(m) },
  });
  const res = await ban.execute({ userId: 'u2', adminId: 'admin1', reason: 'x' });
  assert.equal(res.user.status, 'banned');
  assert.equal(res.sessionsRevoked, null);
  assert.equal(warned.length, 2);
  assert.match(warned.join('\n'), /account\.moderated/);
});

// ---------- Sign-in / refresh ----------
test('login and refresh: suspended -> 403 account_suspended with the end; ended suspension allowed; banned unchanged', async () => {
  const w = world();
  const hasher = { compare: async (p, h) => h === `h:${p}` };
  const login = new Login({ userRepo: w.userRepo, hasher, tokens: fakeTokens, policy: { maxAttempts: 5, lockMs: 60_000 }, sessions: w.sessions, now: () => NOW });

  await w.suspend.execute({ userId: 'u1', adminId: 'admin1', reason: 'x', days: 1 });
  const until = new Date(NOW.getTime() + DAY);
  await assert.rejects(login.execute({ email: 'an@mail.com', password: 'pw' }), (e) => {
    assert.ok(e instanceof AccountSuspendedError);
    assert.equal(e.status, 403);
    assert.equal(e.code, 'account_suspended');
    assert.equal(e.message, `Tài khoản đang bị tạm khoá đến ${formatVietnamTime(until)}`);
    assert.equal(e.message, 'Tài khoản đang bị tạm khoá đến 10:00 04/11/2026');
    assert.deepEqual(e.details, { suspendedUntil: until.toISOString() });
    return true;
  });

  const refresh = new RefreshToken({ userRepo: w.userRepo, tokens: fakeTokens, sessions: w.sessions, sessionRepo: w.sessionRepo, policy: { idleDays: 7, maxDays: 30 }, now: () => NOW });
  await rejectsWith(refresh.execute({ refreshToken: 'rt:u1:s1' }), 403, 'account_suspended');

  // Ended suspension: sign-in and refresh work again (nothing rewrites the row).
  const ok = await login.execute({ email: 'dung@mail.com', password: 'pw' });
  assert.ok(ok.accessToken);
  const later = new Login({ userRepo: w.userRepo, hasher, tokens: fakeTokens, policy: { maxAttempts: 5, lockMs: 60_000 }, now: () => new Date(NOW.getTime() + 2 * DAY) });
  assert.ok((await later.execute({ email: 'an@mail.com', password: 'pw' })).accessToken);

  await rejectsWith(login.execute({ email: 'em@mail.com', password: 'pw' }), 403, 'account_banned');
  await rejectsWith(refresh.execute({ refreshToken: 'rt:u5:x' }), 403, 'account_banned');
});

test('a failed sign-in saving its counter never undoes the status (save does not write it)', async () => {
  const w = world();
  const stale = await w.userRepo.findById('u2'); // read before the ban
  await w.ban.execute({ userId: 'u2', adminId: 'admin1', reason: 'x' });
  stale.registerFailedLogin({ maxAttempts: 5, lockMs: 1000, now: NOW });
  await w.userRepo.save(stale);
  assert.equal(w.userRepo.rows.get('u2').status, 'banned');
});

// ---------- HTTP ----------
async function withServer(w, fn) {
  const adminUsersController = new AdminUsersController({
    searchUsers: w.search, getUserForAdmin: w.detail, warnUser: w.warn, suspendUser: w.suspend, banUser: w.ban, restoreUser: w.restore,
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
  app.use('/', buildAuthRouter({ authController: new AuthController({}), adminUsersController, requireAuth: guard(), requireAdmin: guard(['admin']) }));
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

test('HTTP: admin only (401 / 403), search query validated, detail 404', async () => {
  const w = world();
  await withServer(w, async (call) => {
    assert.equal((await call('GET', '/admin/users')).status, 401);
    assert.equal((await call('GET', '/admin/users', { as: 'u1:contributor' })).status, 403);
    assert.equal((await call('POST', '/admin/users/u2/ban', { as: 'u1:contributor', body: { reason: 'x' } })).status, 403);

    const list = await call('GET', '/admin/users?q=mail.com&role=contributor&page=1&limit=2', { as: 'admin1:admin' });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((u) => u.id), ['u4', 'u3']);
    assert.equal(list.body.total, 3);
    assert.equal((await call('GET', '/admin/users?limit=51', { as: 'admin1:admin' })).status, 400);
    assert.equal((await call('GET', '/admin/users?status=deleted', { as: 'admin1:admin' })).status, 400);

    const detail = await call('GET', '/admin/users/u1', { as: 'admin1:admin' });
    assert.equal(detail.body.activeSessions, 2);
    const missing = await call('GET', '/admin/users/ghost', { as: 'admin1:admin' });
    assert.deepEqual([missing.status, missing.body.code, missing.body.error], [404, 'user_not_found', 'Không tìm thấy tài khoản']);
  });
});

test('HTTP: actions validate the reason (422), guard self / admin targets, answer 409 on conflicts', async () => {
  const w = world();
  await withServer(w, async (call) => {
    const admin = 'admin1:admin';
    for (const body of [{}, { reason: '   ' }, { reason: 'r'.repeat(1001) }, { reason: 5 }]) {
      const res = await call('POST', '/admin/users/u2/warn', { as: admin, body });
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.equal(res.body.code, 'validation_error');
    }
    for (const body of [{ reason: 'x' }, { reason: 'x', days: 3 }, { reason: 'x', days: 1, until: '2026-12-01T00:00:00Z' }, { reason: 'x', until: 'tomorrow' }]) {
      assert.equal((await call('POST', '/admin/users/u2/suspend', { as: admin, body })).status, 422, JSON.stringify(body));
    }
    assert.equal((await call('POST', '/admin/users/u2/suspend', { as: admin, body: { reason: 'x', until: '2026-11-01T00:00:00Z' } })).status, 422);

    const self = await call('POST', '/admin/users/admin1/ban', { as: admin, body: { reason: 'x' } });
    assert.deepEqual([self.status, self.body.code], [403, 'self_action']);
    const other = await call('POST', '/admin/users/admin2/suspend', { as: admin, body: { reason: 'x', days: 1 } });
    assert.deepEqual([other.status, other.body.code], [403, 'target_is_admin']);

    const warned = await call('POST', '/admin/users/u2/warn', { as: admin, body: { reason: '  Spam  ' } });
    assert.equal(warned.status, 200);
    assert.equal(w.publisher.events.at(-1).payload.reason, 'Spam'); // trimmed

    const suspended = await call('POST', '/admin/users/u1/suspend', { as: admin, body: { reason: 'Sai', days: 30 } });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.user.status, 'suspended');
    assert.equal(suspended.body.sessionsRevoked, 2);

    assert.equal((await call('POST', '/admin/users/u2/ban', { as: admin, body: { reason: 'Lừa đảo' } })).status, 200);
    const twice = await call('POST', '/admin/users/u2/ban', { as: admin, body: { reason: 'Lừa đảo' } });
    assert.deepEqual([twice.status, twice.body.code], [409, 'account_already_banned']);

    assert.equal((await call('POST', '/admin/users/u2/restore', { as: admin })).status, 200);
    const again = await call('POST', '/admin/users/u2/restore', { as: admin, body: { reason: '' } });
    assert.deepEqual([again.status, again.body.code], [409, 'account_not_restricted']);

    // Every published payload passed the shared contract (ValidatingPublisher).
    assert.deepEqual(w.publisher.events.map((e) => e.payload.action), ['warn', 'suspend', 'ban', 'restore']);
  });
});
