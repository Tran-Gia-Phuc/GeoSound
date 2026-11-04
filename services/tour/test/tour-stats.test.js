// =========================================================
// UC17 (#271) — tour statistics: domain rules, use cases with an in-memory stats repository (same
// semantics as the SQL in PrismaTourStatsRepository: unique mark, daily cap, counter only on a new
// mark), and the HTTP routes with stand-ins for verifyJwt.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import {
  ACTIVITY_COUNTERS,
  DAILY_MARK_CAP,
  actorKey,
  utcDay,
  addDays,
  isDay,
  resolvePeriod,
  totalsOf,
} from '../src/domain/entities/tour-stats.js';
import { RecordTourActivity, GetTourStats, PurgeActivityMarks } from '../src/application/use-cases/tour-stats.js';
import { TourStatsController } from '../src/interfaces/http/controllers/tour-stats-controller.js';
import { buildTourStatsRouter } from '../src/interfaces/http/routes/tour-stats-routes.js';
import { optionalAuth } from '../src/interfaces/http/middleware/optional-auth.js';

const PUBLIC_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const DEVICE_A = 'device-aaaa-0001';
const DEVICE_B = 'device-bbbb-0002';

function makeTour(id, { status = TOUR_STATUS.PUBLIC, authorId = 'author', averageRating = 0, ratingCount = 0 } = {}) {
  return new Tour({ id, title: `Tour ${id.slice(0, 4)}`, originalLanguage: 'vi', authorId, status, averageRating, ratingCount });
}

class FakeTourRepo {
  constructor(tours) {
    this.rows = new Map(tours.map((t) => [t.id, t]));
  }
  async findById(id) {
    return this.rows.get(id) ?? null;
  }
  async findPublicById(id) {
    const t = this.rows.get(id);
    return t && t.status === TOUR_STATUS.PUBLIC ? t : null;
  }
}

class FakeStatsRepo {
  constructor() {
    this.marks = new Set();
    this.daily = new Map(); // `${tourId}|${day}|${language}` -> counters
    this.comments = [];
  }
  async recordActivity({ tourId, actorKey: key, action, language, day, cap }) {
    const mark = [tourId, key, action, language, day].join('|');
    const today = [...this.marks].filter((m) => m.split('|')[1] === key && m.split('|')[4] === day).length;
    if (today >= cap || this.marks.has(mark)) return false;
    this.marks.add(mark);
    const k = `${tourId}|${day}|${language}`;
    const row = this.daily.get(k) ?? { tourId, day, language, views: 0, plays: 0, completions: 0, downloads: 0 };
    row[ACTIVITY_COUNTERS[action]] += 1;
    this.daily.set(k, row);
    return true;
  }
  async dailyStats(tourId, { from, to, language }) {
    const byDay = new Map();
    for (const r of this.daily.values()) {
      if (r.tourId !== tourId || r.day < from || r.day > to || (language && r.language !== language)) continue;
      const d = byDay.get(r.day) ?? { day: r.day, views: 0, plays: 0, completions: 0, downloads: 0 };
      for (const c of Object.values(ACTIVITY_COUNTERS)) d[c] += r[c];
      byDay.set(r.day, d);
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }
  async latestComments(tourId, { take }) {
    const rows = this.comments.filter((c) => c.tourId === tourId && c.comment);
    return { items: rows.slice(0, take).map(({ tourId: _t, ...rest }) => rest), total: rows.length };
  }
  async purgeMarksBefore(day) {
    let n = 0;
    for (const m of [...this.marks]) if (m.split('|')[4] < day) (this.marks.delete(m), (n += 1));
    return n;
  }
}

const fakeRatingRepo = { distribution: async () => ({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 }) };

function kit({ now = '2026-11-04T10:00:00Z' } = {}) {
  const clock = { at: new Date(now) };
  const tourRepo = new FakeTourRepo([
    makeTour(PUBLIC_ID, { averageRating: 4.6, ratingCount: 128 }),
    makeTour(DRAFT_ID, { status: TOUR_STATUS.DRAFT }),
    makeTour(OTHER_ID, { authorId: 'someone-else' }),
  ]);
  const statsRepo = new FakeStatsRepo();
  const nowFn = () => clock.at;
  return {
    clock,
    tourRepo,
    statsRepo,
    record: new RecordTourActivity({ tourRepo, statsRepo, salt: 'test-salt', now: nowFn }),
    stats: new GetTourStats({ tourRepo, statsRepo, ratingRepo: fakeRatingRepo, now: nowFn }),
    purge: new PurgeActivityMarks({ statsRepo, now: nowFn }),
  };
}

// ---------- domain ----------
test('UTC day bucket, day arithmetic and calendar check', () => {
  assert.equal(utcDay(new Date('2026-11-04T23:59:59+07:00')), '2026-11-04');
  assert.equal(utcDay(new Date('2026-11-05T01:00:00+07:00')), '2026-11-04'); // still the 4th in UTC
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(isDay('2026-02-29'), false);
  assert.equal(isDay('2028-02-29'), true);
  assert.equal(isDay('2026-1-1'), false);
});

test('actor key: hashed, salted, account and device kept apart, null without an actor', () => {
  const k = actorKey({ deviceId: DEVICE_A, salt: 's' });
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.ok(!k.includes(DEVICE_A));
  assert.equal(actorKey({ deviceId: DEVICE_A, salt: 's' }), k);
  assert.notEqual(actorKey({ deviceId: DEVICE_A, salt: 't' }), k);
  assert.notEqual(actorKey({ userId: DEVICE_A, salt: 's' }), k);
  assert.equal(actorKey({ userId: 'u1', deviceId: DEVICE_A, salt: 's' }), actorKey({ userId: 'u1', salt: 's' })); // account wins
  assert.equal(actorKey({ salt: 's' }), null);
  assert.equal(actorKey({ deviceId: DEVICE_A, salt: '' }), actorKey({ deviceId: DEVICE_A })); // empty salt = default
});

test('period: default last 30 days, from only, max 366 days, order and format checked', () => {
  const now = new Date('2026-11-04T10:00:00Z');
  assert.deepEqual(resolvePeriod({ now }), { from: '2026-10-06', to: '2026-11-04' });
  assert.deepEqual(resolvePeriod({ from: '2026-11-01', now }), { from: '2026-11-01', to: '2026-11-04' });
  assert.deepEqual(resolvePeriod({ to: '2026-01-31', now }), { from: '2026-01-02', to: '2026-01-31' });
  assert.deepEqual(resolvePeriod({ from: '2025-11-04', to: '2026-11-04', now }), { from: '2025-11-04', to: '2026-11-04' }); // 366 days
  assert.throws(() => resolvePeriod({ from: '2025-11-03', to: '2026-11-04', now }), { code: 'validation_error' });
  assert.throws(() => resolvePeriod({ from: '2026-11-04', to: '2026-11-01', now }), { code: 'validation_error' });
  assert.throws(() => resolvePeriod({ from: '2026-02-30', now }), { code: 'validation_error' });
});

test('totals and completion rate', () => {
  assert.deepEqual(totalsOf([]), { views: 0, plays: 0, completions: 0, downloads: 0, completionRate: 0 });
  const t = totalsOf([
    { views: 5, plays: 3, completions: 1, downloads: 1 },
    { views: 1, plays: 0, completions: 1, downloads: 0 },
  ]);
  assert.deepEqual(t, { views: 6, plays: 3, completions: 2, downloads: 1, completionRate: 0.6667 });
  assert.equal(totalsOf([{ views: 0, plays: 1, completions: 3, downloads: 0 }]).completionRate, 1); // capped
});

// ---------- use cases ----------
test('one count per tour, actor, action, language and UTC day; next day counts again', async () => {
  const k = kit();
  for (let i = 0; i < 5; i += 1) await k.record.execute({ tourId: PUBLIC_ID, action: 'view', deviceId: DEVICE_A });
  assert.equal((await k.stats.execute({ tourId: PUBLIC_ID, userId: 'author' })).totals.views, 1);

  await k.record.execute({ tourId: PUBLIC_ID, action: 'view', deviceId: DEVICE_B }); // other device
  await k.record.execute({ tourId: PUBLIC_ID, action: 'view', language: 'en', deviceId: DEVICE_A }); // other language
  await k.record.execute({ tourId: PUBLIC_ID, action: 'play', deviceId: DEVICE_A }); // other action
  let s = await k.stats.execute({ tourId: PUBLIC_ID, userId: 'author' });
  assert.equal(s.totals.views, 3);
  assert.equal(s.totals.plays, 1);

  k.clock.at = new Date('2026-11-05T00:00:01Z'); // next UTC day
  const { counted } = await k.record.execute({ tourId: PUBLIC_ID, action: 'view', deviceId: DEVICE_A });
  assert.equal(counted, true);
  s = await k.stats.execute({ tourId: PUBLIC_ID, userId: 'author' });
  assert.equal(s.totals.views, 4);
  assert.deepEqual(s.daily.map((d) => [d.day, d.views]), [['2026-11-04', 3], ['2026-11-05', 1]]);
});

test('signed-in actor counts by account across devices; anonymous by device', async () => {
  const k = kit();
  await k.record.execute({ tourId: PUBLIC_ID, action: 'download', userId: 'u1', deviceId: DEVICE_A });
  await k.record.execute({ tourId: PUBLIC_ID, action: 'download', userId: 'u1', deviceId: DEVICE_B }); // same account
  await k.record.execute({ tourId: PUBLIC_ID, action: 'download', deviceId: DEVICE_A }); // anonymous on that device
  const s = await k.stats.execute({ tourId: PUBLIC_ID, userId: 'author' });
  assert.equal(s.totals.downloads, 2);
  await assert.rejects(k.record.execute({ tourId: PUBLIC_ID, action: 'view' }), { code: 'validation_error' });
  await assert.rejects(k.record.execute({ tourId: PUBLIC_ID, action: 'like', deviceId: DEVICE_A }), { code: 'validation_error' });
});

test('only public tours count; unknown and draft tours are a silent no-op', async () => {
  const k = kit();
  assert.deepEqual(await k.record.execute({ tourId: DRAFT_ID, action: 'view', deviceId: DEVICE_A }), { counted: false });
  assert.deepEqual(
    await k.record.execute({ tourId: '44444444-4444-4444-8444-444444444444', action: 'view', deviceId: DEVICE_A }),
    { counted: false },
  );
  assert.equal(k.statsRepo.marks.size, 0);
});

test(`daily cap: at most ${DAILY_MARK_CAP} marks per actor and day across tours`, async () => {
  const k = kit();
  const langs = Array.from({ length: 60 }, (_, i) => `l${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
  let counted = 0;
  for (const language of langs) {
    for (const action of Object.keys(ACTIVITY_COUNTERS)) {
      if ((await k.record.execute({ tourId: PUBLIC_ID, action, language, deviceId: DEVICE_A })).counted) counted += 1;
    }
  }
  assert.equal(counted, DAILY_MARK_CAP); // 240 tries
  assert.equal((await k.record.execute({ tourId: OTHER_ID, action: 'view', deviceId: DEVICE_A })).counted, false);
  assert.equal((await k.record.execute({ tourId: OTHER_ID, action: 'view', deviceId: DEVICE_B })).counted, true); // others unaffected
  k.clock.at = new Date('2026-11-05T08:00:00Z');
  assert.equal((await k.record.execute({ tourId: OTHER_ID, action: 'view', deviceId: DEVICE_A })).counted, true);
});

test('stats: period and language filters, ratings, comments, zeros without data (E1)', async () => {
  const k = kit();
  k.statsRepo.comments.push({ tourId: PUBLIC_ID, id: 'r1', userName: 'An', stars: 5, comment: 'Hay', createdAt: new Date() });
  const empty = await k.stats.execute({ tourId: PUBLIC_ID, userId: 'author' });
  assert.deepEqual(empty.totals, { views: 0, plays: 0, completions: 0, downloads: 0, completionRate: 0 });
  assert.deepEqual(empty.daily, []);
  assert.equal(empty.language, null);
  assert.deepEqual(empty.ratings, { averageRating: 4.6, ratingCount: 128, distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 } });
  assert.equal(empty.comments.total, 1);
  assert.equal(empty.comments.items[0].userId, undefined);

  k.clock.at = new Date('2026-10-01T09:00:00Z');
  await k.record.execute({ tourId: PUBLIC_ID, action: 'play', deviceId: DEVICE_A });
  k.clock.at = new Date('2026-11-04T09:00:00Z');
  await k.record.execute({ tourId: PUBLIC_ID, action: 'play', deviceId: DEVICE_A });
  await k.record.execute({ tourId: PUBLIC_ID, action: 'play', language: 'en', deviceId: DEVICE_B });
  await k.record.execute({ tourId: PUBLIC_ID, action: 'complete', language: 'en', deviceId: DEVICE_B });

  const last30 = await k.stats.execute({ tourId: PUBLIC_ID, userId: 'author' });
  assert.equal(last30.from, '2026-10-06');
  assert.equal(last30.totals.plays, 2); // 1 Oct is outside
  assert.equal(last30.totals.completionRate, 0.5);

  const en = await k.stats.execute({ tourId: PUBLIC_ID, userId: 'author', language: 'en' });
  assert.equal(en.language, 'en');
  assert.deepEqual(en.totals, { views: 0, plays: 1, completions: 1, downloads: 0, completionRate: 1 });

  const oct = await k.stats.execute({ tourId: PUBLIC_ID, userId: 'author', from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(oct.daily, [{ day: '2026-10-01', views: 0, plays: 1, completions: 0, downloads: 0 }]);
});

test('stats access: owner and admin allowed, other users 403, missing tour 404', async () => {
  const k = kit();
  await k.stats.execute({ tourId: PUBLIC_ID, userId: 'author', role: 'contributor' });
  await k.stats.execute({ tourId: PUBLIC_ID, userId: 'admin-1', role: 'admin' });
  await k.stats.execute({ tourId: DRAFT_ID, userId: 'author', role: 'contributor' }); // any status for the owner
  await assert.rejects(k.stats.execute({ tourId: OTHER_ID, userId: 'author', role: 'contributor' }), { code: 'not_tour_owner', status: 403 });
  await assert.rejects(
    k.stats.execute({ tourId: '44444444-4444-4444-8444-444444444444', userId: 'author' }),
    { code: 'tour_not_found' },
  );
});

test('purge removes marks older than 40 days only', async () => {
  const k = kit();
  k.clock.at = new Date('2026-09-20T09:00:00Z');
  await k.record.execute({ tourId: PUBLIC_ID, action: 'view', deviceId: DEVICE_A });
  k.clock.at = new Date('2026-09-30T09:00:00Z');
  await k.record.execute({ tourId: PUBLIC_ID, action: 'view', deviceId: DEVICE_A });
  k.clock.at = new Date('2026-11-04T09:00:00Z'); // cutoff 2026-09-25
  assert.deepEqual(await k.purge.execute(), { deleted: 1 });
  assert.equal(k.statsRepo.marks.size, 1);
});

// ---------- HTTP ----------
test('HTTP: optional sign-in activity beacon and owner/admin stats route', async () => {
  const k = kit();
  const controller = new TourStatsController({ recordTourActivity: k.record, getTourStats: k.stats });
  // Stand-in for shared verifyJwt(roles): "Bearer <sub>:<role>", "Bearer bad" = invalid token.
  const verifyJwt = (roles = []) => (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const [sub, role = 'tourist'] = h.slice(7).split(':');
    if (sub === 'bad') return res.status(401).json({ error: 'Invalid token' });
    if (roles.length && !roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    req.user = { sub, role };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    buildTourStatsRouter({
      tourStatsController: controller,
      optionalAuth: optionalAuth(verifyJwt()),
      requireOwnerRole: verifyJwt(['contributor', 'admin']),
    }),
  );
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (who) => ({ 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${who}` } : {}) });
  const post = (id, body, who) => fetch(`${base}/${id}/activity`, { method: 'POST', headers: json(who), body: JSON.stringify(body) });
  const get = (id, q, who) => fetch(`${base}/mine/${id}/stats${q}`, { headers: json(who) });
  try {
    assert.equal((await post(PUBLIC_ID, { action: 'view', deviceId: DEVICE_A })).status, 204); // anonymous
    assert.equal((await post(PUBLIC_ID, { action: 'view', deviceId: DEVICE_A })).status, 204); // repeat, not counted
    assert.equal((await post(PUBLIC_ID, { action: 'view' }, 'u1')).status, 204); // signed in, no device id
    assert.equal((await post(PUBLIC_ID, { action: 'view', deviceId: DEVICE_B }, 'bad')).status, 204); // bad token -> device
    const noActor = await post(PUBLIC_ID, { action: 'view' });
    assert.equal(noActor.status, 400);
    assert.equal((await noActor.json()).error, 'Thiếu mã thiết bị');
    assert.equal((await post(PUBLIC_ID, { action: 'view' }, 'bad')).status, 400); // bad token and no device id
    assert.equal((await post(PUBLIC_ID, { action: 'like', deviceId: DEVICE_A })).status, 400);
    assert.equal((await post(PUBLIC_ID, { deviceId: DEVICE_A })).status, 400);
    assert.equal((await post(PUBLIC_ID, { action: 'view', deviceId: 'short' })).status, 400);
    assert.equal((await post(PUBLIC_ID, { action: 'view', deviceId: DEVICE_A, language: 'not a lang' })).status, 400);
    assert.equal((await post(DRAFT_ID, { action: 'view', deviceId: DEVICE_A })).status, 204); // no-op, status not revealed
    assert.equal((await post('not-a-uuid', { action: 'view', deviceId: DEVICE_A })).status, 404);

    assert.equal((await get(PUBLIC_ID, '')).status, 401);
    assert.equal((await get(PUBLIC_ID, '', 'u1:tourist')).status, 403);
    const other = await get(OTHER_ID, '', 'author:contributor');
    assert.equal(other.status, 403);
    assert.equal((await other.json()).code, 'not_tour_owner');
    assert.equal((await get(PUBLIC_ID, '?from=2026-13-01', 'author:contributor')).status, 400);
    assert.equal((await get(PUBLIC_ID, '?from=2026-11-05&to=2026-11-01', 'author:contributor')).status, 400);

    const mine = await get(PUBLIC_ID, '', 'author:contributor');
    assert.equal(mine.status, 200);
    const body = await mine.json();
    assert.equal(body.tourId, PUBLIC_ID);
    assert.equal(body.totals.views, 3); // device A, account u1, device B
    assert.equal(body.daily.length, 1);
    assert.equal((await get(OTHER_ID, '?language=EN', 'admin-1:admin')).status, 200); // admin, language lower-cased
  } finally {
    await new Promise((r) => server.close(r));
  }
});
