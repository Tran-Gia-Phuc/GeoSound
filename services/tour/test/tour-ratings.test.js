// =========================================================
// UC05 (#267) — tour ratings: domain rules, use cases with in-memory fakes (same aggregate math as
// the SQL in PrismaTourRatingRepository), and the HTTP routes with a stand-in for verifyJwt().
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import {
  TourRating,
  normalizeRatingInput,
  reviewerName,
  ratingDelta,
  DEFAULT_REVIEWER_NAME,
  RATING_COMMENT_MAX,
} from '../src/domain/entities/tour-rating.js';
import {
  ListTourRatings,
  GetMyTourRating,
  SaveMyTourRating,
  DeleteMyTourRating,
} from '../src/application/use-cases/tour-ratings.js';
import { schemaFromUrl } from '../src/infrastructure/persistence/schema-name.js';
import { TourRatingController } from '../src/interfaces/http/controllers/tour-rating-controller.js';
import { buildTourRatingRouter } from '../src/interfaces/http/routes/tour-rating-routes.js';

const PUBLIC_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const SEEDED_ID = '33333333-3333-4333-8333-333333333333';

function makeTour(id, { status = TOUR_STATUS.PUBLIC, averageRating = 0, ratingCount = 0, authorId = 'author' } = {}) {
  return new Tour({ id, title: `Tour ${id.slice(0, 4)}`, originalLanguage: 'vi', authorId, status, averageRating, ratingCount });
}

class FakeTourRepo {
  constructor(tours) {
    this.rows = new Map(tours.map((t) => [t.id, t]));
  }
  async findPublicById(id) {
    const t = this.rows.get(id);
    return t && t.status === TOUR_STATUS.PUBLIC ? t : null;
  }
}

// Same semantics as PrismaTourRatingRepository: unique (tour, user), create-or-edit per account,
// aggregate moved from the previous average and count (keeps seeded values). Single-threaded, like
// the row lock of the real repository.
class FakeRatingRepo {
  constructor(tourRepo) {
    this.tourRepo = tourRepo;
    this.rows = new Map();
    this.clock = Date.parse('2026-11-03T08:00:00Z');
  }
  move(tourId, { count, sum }) {
    const t = this.tourRepo.rows.get(tourId);
    const n = t.ratingCount + count;
    t.averageRating = n <= 0 ? 0 : Math.min(Math.max((t.averageRating * t.ratingCount + sum) / n, 0), 5);
    t.ratingCount = Math.max(n, 0);
    return { averageRating: t.averageRating, ratingCount: t.ratingCount };
  }
  async findByTourAndUser(tourId, userId) {
    return [...this.rows.values()].find((r) => r.tourId === tourId && r.userId === userId) ?? null;
  }
  async saveForUser({ tourId, userId, userName, stars, comment }) {
    const own = await this.findByTourAndUser(tourId, userId);
    this.clock += 1000;
    if (own) {
      const old = own.stars;
      Object.assign(own, { stars, comment, userName, updatedAt: new Date(this.clock) });
      return { created: false, rating: own, summary: this.move(tourId, ratingDelta.updated(old, stars)) };
    }
    const row = new TourRating({ id: crypto.randomUUID(), tourId, userId, userName, stars, comment, createdAt: new Date(this.clock), updatedAt: new Date(this.clock) });
    this.rows.set(row.id, row);
    return { created: true, rating: row, summary: this.move(tourId, ratingDelta.created(stars)) };
  }
  async deleteForUser(tourId, userId) {
    const own = await this.findByTourAndUser(tourId, userId);
    if (!own) return null;
    this.rows.delete(own.id);
    return { summary: this.move(tourId, ratingDelta.deleted(own.stars)) };
  }
  async listByTour(tourId, { skip, take }) {
    const all = [...this.rows.values()].filter((r) => r.tourId === tourId).sort((a, b) => b.createdAt - a.createdAt);
    return { items: all.slice(skip, skip + take), total: all.length };
  }
  async distribution(tourId) {
    const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of this.rows.values()) if (r.tourId === tourId) out[r.stars] += 1;
    return out;
  }
}

function kit() {
  const tourRepo = new FakeTourRepo([
    makeTour(PUBLIC_ID),
    makeTour(DRAFT_ID, { status: TOUR_STATUS.DRAFT }),
    makeTour(SEEDED_ID, { averageRating: 4.6, ratingCount: 128 }),
  ]);
  const ratingRepo = new FakeRatingRepo(tourRepo);
  const deps = { tourRepo, ratingRepo };
  return {
    tourRepo,
    ratingRepo,
    list: new ListTourRatings(deps),
    mine: new GetMyTourRating(deps),
    save: new SaveMyTourRating(deps),
    remove: new DeleteMyTourRating(deps),
  };
}

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// ---------- domain ----------
test('input rules: stars 1..5 required (E2), comment trimmed, empty -> null, length limit', () => {
  assert.throws(() => normalizeRatingInput({}), { code: 'validation_error', message: 'Vui lòng chọn số sao' });
  for (const stars of [0, 6, 2.5, 'abc']) assert.throws(() => normalizeRatingInput({ stars }), { code: 'validation_error' });
  assert.deepEqual(normalizeRatingInput({ stars: 4, comment: '  Hay lắm  ' }), { stars: 4, comment: 'Hay lắm' });
  assert.deepEqual(normalizeRatingInput({ stars: 5, comment: '   ' }), { stars: 5, comment: null });
  assert.deepEqual(normalizeRatingInput({ stars: '3' }), { stars: 3, comment: null });
  assert.throws(() => normalizeRatingInput({ stars: 5, comment: 'x'.repeat(RATING_COMMENT_MAX + 1) }), { code: 'validation_error' });
});

test('reviewer name: token name trimmed, fallback without a name, never empty', () => {
  assert.equal(reviewerName('  Trần   Gia Phúc '), 'Trần Gia Phúc');
  assert.equal(reviewerName(undefined), DEFAULT_REVIEWER_NAME);
  assert.equal(reviewerName('   '), DEFAULT_REVIEWER_NAME);
  assert.equal(reviewerName('x'.repeat(500)).length, 120);
});

test('public view never exposes the user id', () => {
  const r = new TourRating({ id: 'r1', tourId: PUBLIC_ID, userId: 'secret-user', userName: 'An', stars: 5 });
  assert.deepEqual(Object.keys(r.toPublic()).sort(), ['comment', 'createdAt', 'id', 'stars', 'updatedAt', 'userName']);
});

test('schema of the aggregate SQL comes from DATABASE_URL', () => {
  assert.equal(schemaFromUrl('postgresql://u:p@h:5432/db?schema=tour&pgbouncer=true'), 'tour');
  assert.equal(schemaFromUrl('postgresql://u:p@h:5432/db'), 'public');
  assert.equal(schemaFromUrl('postgresql://u:p@h/db?schema=bad;drop'), 'public');
  assert.equal(schemaFromUrl(undefined), 'public');
});

// ---------- use cases ----------
test('create, edit and delete keep the average and the count exact (R2, R7, A1)', async () => {
  const k = kit();
  const a = await k.save.execute({ tourId: PUBLIC_ID, userId: 'u1', userName: 'An', stars: 5, comment: 'Tuyệt' });
  assert.equal(a.created, true);
  assert.deepEqual(a.summary, { averageRating: 5, ratingCount: 1 });
  const b = await k.save.execute({ tourId: PUBLIC_ID, userId: 'u2', userName: 'Bình', stars: 2 });
  assert.deepEqual(b.summary, { averageRating: 3.5, ratingCount: 2 });

  // A second submit by u1 edits the rating: count stays 2.
  const edit = await k.save.execute({ tourId: PUBLIC_ID, userId: 'u1', userName: 'An', stars: 3, comment: '' });
  assert.equal(edit.created, false);
  assert.equal(edit.rating.comment, null);
  assert.deepEqual(edit.summary, { averageRating: 2.5, ratingCount: 2 });
  assert.equal(k.ratingRepo.rows.size, 2);

  const del = await k.remove.execute({ tourId: PUBLIC_ID, userId: 'u2' });
  assert.deepEqual(del.summary, { averageRating: 3, ratingCount: 1 });
  const last = await k.remove.execute({ tourId: PUBLIC_ID, userId: 'u1' });
  assert.deepEqual(last.summary, { averageRating: 0, ratingCount: 0 });
  await assert.rejects(k.remove.execute({ tourId: PUBLIC_ID, userId: 'u1' }), { status: 404, code: 'rating_not_found' });
});

test('seeded demo values are the starting point and come back after a delete', async () => {
  const k = kit();
  const r = await k.save.execute({ tourId: SEEDED_ID, userId: 'u1', userName: 'An', stars: 5 });
  assert.equal(r.summary.ratingCount, 129);
  near(r.summary.averageRating, (4.6 * 128 + 5) / 129);
  const d = await k.remove.execute({ tourId: SEEDED_ID, userId: 'u1' });
  assert.equal(d.summary.ratingCount, 128);
  near(d.summary.averageRating, 4.6);
});

test('only public tours (R4), never the own tour (R5), validation before any read', async () => {
  const k = kit();
  await assert.rejects(k.save.execute({ tourId: DRAFT_ID, userId: 'u1', stars: 4 }), { status: 404, code: 'tour_not_found' });
  await assert.rejects(k.list.execute({ tourId: DRAFT_ID }), { status: 404 });
  await assert.rejects(k.mine.execute({ tourId: DRAFT_ID, userId: 'u1' }), { status: 404 });
  await assert.rejects(k.save.execute({ tourId: PUBLIC_ID, userId: 'author', stars: 5 }), { status: 403, code: 'own_tour' });
  await assert.rejects(k.save.execute({ tourId: PUBLIC_ID, userId: 'u1' }), { code: 'validation_error', message: 'Vui lòng chọn số sao' });
  assert.equal(k.ratingRepo.rows.size, 0);
});

test('two first submits of one account racing on the unique key: the loser edits instead (R2)', async () => {
  const k = kit();
  const realSave = k.ratingRepo.saveForUser.bind(k.ratingRepo);
  let calls = 0;
  k.ratingRepo.saveForUser = async (fields) => {
    calls += 1;
    if (calls === 1) {
      await realSave({ ...fields, stars: 1 }); // the concurrent first submit wins the insert
      return null; // ours hit the unique key (P2002)
    }
    return realSave(fields);
  };
  const r = await k.save.execute({ tourId: PUBLIC_ID, userId: 'u1', userName: 'An', stars: 5 });
  assert.equal(calls, 2);
  assert.equal(r.created, false);
  assert.deepEqual(r.summary, { averageRating: 5, ratingCount: 1 });
  assert.equal(k.ratingRepo.rows.size, 1);

  k.ratingRepo.saveForUser = async () => null; // keeps conflicting: a clear error, no loop
  await assert.rejects(k.save.execute({ tourId: PUBLIC_ID, userId: 'u2', stars: 3 }), /conflicted twice/);
});

test('list: summary with distribution, newest first, paging, my rating', async () => {
  const k = kit();
  for (const [u, stars] of [['u1', 5], ['u2', 4], ['u3', 4], ['u4', 1]]) {
    await k.save.execute({ tourId: PUBLIC_ID, userId: u, userName: u.toUpperCase(), stars, comment: `c-${u}` });
  }
  const page1 = await k.list.execute({ tourId: PUBLIC_ID, page: 1, limit: 3 });
  assert.deepEqual(page1.summary, { averageRating: 3.5, ratingCount: 4, distribution: { 1: 1, 2: 0, 3: 0, 4: 2, 5: 1 } });
  assert.deepEqual(page1.items.map((i) => i.userName), ['U4', 'U3', 'U2']);
  assert.equal(page1.total, 4);
  const page2 = await k.list.execute({ tourId: PUBLIC_ID, page: 2, limit: 3 });
  assert.deepEqual(page2.items.map((i) => i.userName), ['U1']);
  assert.equal((await k.list.execute({ tourId: PUBLIC_ID, limit: 500 })).limit, 50);

  assert.equal((await k.mine.execute({ tourId: PUBLIC_ID, userId: 'u2' })).rating.stars, 4);
  assert.deepEqual(await k.mine.execute({ tourId: PUBLIC_ID, userId: 'nobody' }), { rating: null });
});

// ---------- HTTP ----------
test('HTTP: public list, signed-in mine / save / delete, status codes and validation', async () => {
  const k = kit();
  const controller = new TourRatingController({
    listTourRatings: k.list,
    getMyTourRating: k.mine,
    saveMyTourRating: k.save,
    deleteMyTourRating: k.remove,
  });
  // Stand-in for shared verifyJwt(): "Bearer <userId>:<name>".
  const requireAuth = (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const [sub, name] = h.slice(7).split(':');
    req.user = { sub, role: 'tourist', ...(name ? { name: decodeURIComponent(name) } : {}) };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/', buildTourRatingRouter({ tourRatingController: controller, requireAuth }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = (who) => ({ authorization: `Bearer ${who}`, 'content-type': 'application/json' });
  const put = (who, body) => fetch(`${base}/${PUBLIC_ID}/ratings/mine`, { method: 'PUT', headers: as(who), body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/${PUBLIC_ID}/ratings/mine`)).status, 401);
    assert.equal((await fetch(`${base}/${PUBLIC_ID}/ratings/mine`, { method: 'PUT', body: '{}' })).status, 401);

    const missing = await put('u1:An', {});
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, 'Vui lòng chọn số sao');
    assert.equal((await put('u1:An', { stars: 7 })).status, 400);

    const created = await put(`u1:${encodeURIComponent('Nguyễn An')}`, { stars: 5, comment: 'Rất hay' });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.rating.userName, 'Nguyễn An');
    assert.deepEqual(body.summary, { averageRating: 5, ratingCount: 1 });

    const edited = await put('u1', { stars: 4 }); // old token without name -> fallback name
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).rating.userName, DEFAULT_REVIEWER_NAME);

    assert.equal((await put('author', { stars: 5 })).status, 403);
    assert.equal((await fetch(`${base}/${DRAFT_ID}/ratings`)).status, 404);
    assert.equal((await fetch(`${base}/not-a-uuid/ratings`)).status, 404); // route needs a UUID

    const list = await fetch(`${base}/${PUBLIC_ID}/ratings?page=1&limit=5`);
    assert.equal(list.status, 200);
    const listed = await list.json();
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0].stars, 4);
    assert.equal(listed.items[0].userId, undefined);

    const mine = await fetch(`${base}/${PUBLIC_ID}/ratings/mine`, { headers: as('u1') });
    assert.equal((await mine.json()).rating.stars, 4);

    assert.equal((await fetch(`${base}/${PUBLIC_ID}/ratings/mine`, { method: 'DELETE', headers: as('u1') })).status, 204);
    assert.equal((await fetch(`${base}/${PUBLIC_ID}/ratings/mine`, { method: 'DELETE', headers: as('u1') })).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
