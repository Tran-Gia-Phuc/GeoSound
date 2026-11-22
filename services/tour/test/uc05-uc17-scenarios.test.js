// =========================================================
// Use-case scenarios: UC05 (rate a tour, report an abusive rating, admin removes / dismisses it) ->
// UC17 (tour statistics: activity beacons, author-only stats, rating block). Each test chains the
// real use cases, controllers and routers over HTTP on 127.0.0.1, so a break between two steps fails.
// Fakes only: one in-memory store per scenario that mirrors the Prisma repositories (aggregate SQL,
// unique keys, hidden / flagged rows); verifyJwt is a stand-in. These flows publish no events.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { TourRating, ratingDelta } from '../src/domain/entities/tour-rating.js';
import { REPORT_STATUSES, RESOLVE_ACTIONS, SOFT_FLAG_THRESHOLD } from '../src/domain/entities/tour-rating-report.js';
import { ACTIVITY_COUNTERS } from '../src/domain/entities/tour-stats.js';
import {
  ListTourRatings, ListMyTourRatings, GetMyTourRating, SaveMyTourRating, DeleteMyTourRating,
} from '../src/application/use-cases/tour-ratings.js';
import { SubmitRatingReport, ListAdminRatingReports, ResolveRatingReport } from '../src/application/use-cases/tour-rating-reports.js';
import { RecordTourActivity, GetTourStats } from '../src/application/use-cases/tour-stats.js';
import { TourRatingController } from '../src/interfaces/http/controllers/tour-rating-controller.js';
import { TourRatingReportController } from '../src/interfaces/http/controllers/tour-rating-report-controller.js';
import { TourStatsController } from '../src/interfaces/http/controllers/tour-stats-controller.js';
import { buildTourRatingRouter } from '../src/interfaces/http/routes/tour-rating-routes.js';
import { buildTourRatingReportRouter, buildAdminRatingReportRouter } from '../src/interfaces/http/routes/tour-rating-report-routes.js';
import { buildTourStatsRouter } from '../src/interfaces/http/routes/tour-stats-routes.js';
import { optionalAuth } from '../src/interfaces/http/middleware/optional-auth.js';

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TOUR = uid(101);
const DRAFT = uid(102);
const OTHER_TOUR = uid(103);
const SEED = { averageRating: 4.5, ratingCount: 10 }; // seeded demo values, no rating rows behind them
const SEED_SUM = SEED.averageRating * SEED.ratingCount;
const DEVICE_A = 'device-aaaa-0001';
const DEVICE_B = 'device-bbbb-0002';

const user = (n, role, name) => ({ sub: uid(n), role, name });
const U = {
  author: user(1, 'contributor', 'Tác giả'),
  other: user(2, 'contributor', 'Tác giả khác'),
  admin: user(3, 'admin', 'Admin'),
  v1: user(11, 'tourist', 'An'),
  v2: user(12, 'tourist', 'Bình'),
  v3: user(13, 'tourist', 'Chi'),
  r1: user(21, 'tourist', 'Dũng'),
  r2: user(22, 'tourist', 'Em'),
};

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
/** Aggregate equals the seed plus the given extra stars sum and count. */
function assertSummary(summary, extraSum, extraCount) {
  assert.equal(summary.ratingCount, SEED.ratingCount + extraCount);
  near(summary.averageRating, (SEED_SUM + extraSum) / (SEED.ratingCount + extraCount));
}

// --- one store behind every repository, same semantics as the Prisma repositories ---
let tick = Date.parse('2026-11-10T08:00:00Z');
const stamp = () => new Date((tick += 1000));

function fakeStore() {
  const mk = (id, status, authorId, seed = {}) =>
    new Tour({ id, title: `Tour ${id.slice(-3)}`, originalLanguage: 'vi', authorId, status, ...seed });
  const tours = new Map([
    [TOUR, mk(TOUR, TOUR_STATUS.PUBLIC, U.author.sub, SEED)],
    [DRAFT, mk(DRAFT, TOUR_STATUS.DRAFT, U.author.sub)],
    [OTHER_TOUR, mk(OTHER_TOUR, TOUR_STATUS.PUBLIC, U.other.sub)],
  ]);
  const ratings = new Map(); // id -> row { ..., isFlagged, isHidden }
  const reports = new Map();
  const marks = new Set();
  const daily = new Map();

  // like #lockOwn: SELECT ... WHERE tour_id AND user_id, hidden rows included
  const ownRow = (tourId, userId) => [...ratings.values()].find((r) => r.tourId === tourId && r.userId === userId) ?? null;
  const visible = (tourId) => [...ratings.values()].filter((r) => r.tourId === tourId && !r.isHidden);
  const summaryOf = (t) => ({ averageRating: t.averageRating, ratingCount: t.ratingCount });
  // same arithmetic as the #moveAggregate UPDATE
  const move = (tourId, { count, sum }) => {
    const t = tours.get(tourId);
    const n = t.ratingCount + count;
    t.averageRating = n <= 0 ? 0 : Math.min(Math.max((t.averageRating * t.ratingCount + sum) / n, 0), 5);
    t.ratingCount = Math.max(n, 0);
    return summaryOf(t);
  };
  const pendingOf = (ratingId) => [...reports.values()].filter((x) => x.ratingId === ratingId && x.status === REPORT_STATUSES.PENDING);

  const tourRepo = {
    rows: tours,
    async findById(id) { return tours.get(id) ?? null; },
    async findPublicById(id) { const t = tours.get(id); return t?.status === TOUR_STATUS.PUBLIC ? t : null; },
  };

  const ratingRepo = {
    async findByTourAndUser(tourId, userId) { const r = ownRow(tourId, userId); return r && !r.isHidden ? new TourRating(r) : null; },
    async saveForUser({ tourId, userId, userName, stars, comment }) {
      const own = ownRow(tourId, userId);
      if (own?.isHidden) {
        Object.assign(own, { stars, comment, userName, isHidden: false, isFlagged: false, createdAt: stamp(), updatedAt: stamp() });
        return { created: true, rating: new TourRating(own), summary: move(tourId, ratingDelta.created(stars)) };
      }
      if (own) {
        const old = own.stars;
        Object.assign(own, { stars, comment, userName, updatedAt: stamp() });
        return { created: false, rating: new TourRating(own), summary: move(tourId, ratingDelta.updated(old, stars)) };
      }
      const at = stamp();
      const row = { id: crypto.randomUUID(), tourId, userId, userName, stars, comment, createdAt: at, updatedAt: at, isFlagged: false, isHidden: false };
      ratings.set(row.id, row);
      return { created: true, rating: new TourRating(row), summary: move(tourId, ratingDelta.created(stars)) };
    },
    async deleteForUser(tourId, userId) {
      const own = ownRow(tourId, userId);
      if (!own || own.isHidden) return null;
      ratings.delete(own.id);
      return { summary: move(tourId, ratingDelta.deleted(own.stars)) };
    },
    async listByTour(tourId, { skip, take }) {
      const all = visible(tourId).sort((a, b) => b.createdAt - a.createdAt);
      return { items: all.slice(skip, skip + take).map((r) => new TourRating(r)), total: all.length };
    },
    async distribution(tourId) {
      const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of visible(tourId)) out[r.stars] += 1;
      return out;
    },
  };

  const reportRepo = {
    async findVisibleRating(tourId, ref) { return visible(tourId).find((r) => r.userId === ref || r.id === ref) ?? null; },
    async createReport({ tourId, ratingId, ratingUserId, reporterId, reporterRole, reasonType, description }) {
      const dup = [...reports.values()].some((x) => x.tourId === tourId && x.ratingUserId === ratingUserId && x.reporterId === reporterId);
      if (dup) return null; // unique (tour_id, rating_user_id, reporter_id) -> P2002
      const at = stamp();
      const report = { id: crypto.randomUUID(), tourId, ratingId, ratingUserId, reporterId, reporterRole, reasonType, description: description ?? null, status: REPORT_STATUSES.PENDING, adminNote: null, resolvedBy: null, createdAt: at, updatedAt: at };
      reports.set(report.id, report);
      const pendingCount = pendingOf(ratingId).length;
      const rating = ratings.get(ratingId);
      if (pendingCount >= SOFT_FLAG_THRESHOLD) rating.isFlagged = true;
      return { report, pendingCount, isFlagged: rating.isFlagged };
    },
    async listAdminReports({ status, skip, take }) {
      const all = [...reports.values()].filter((r) => r.status === status).map((r) => {
        const rating = ratings.get(r.ratingId);
        return {
          ...r,
          pendingCount: pendingOf(r.ratingId).length,
          rating: rating ? { id: rating.id, userName: rating.userName, stars: rating.stars, comment: rating.comment, isFlagged: rating.isFlagged, isHidden: rating.isHidden } : null,
        };
      }).sort((a, b) =>
        Number(Boolean(b.rating?.isFlagged)) - Number(Boolean(a.rating?.isFlagged))
        || Number(b.reporterRole === 'AUTHOR') - Number(a.reporterRole === 'AUTHOR')
        || b.createdAt - a.createdAt);
      return { items: all.slice(skip, skip + take), total: all.length };
    },
    async resolveReport({ reportId, action, adminId, adminNote }) {
      const target = reports.get(reportId);
      if (!target) return null;
      const rating = ratings.get(target.ratingId);
      if (!rating) return null;
      const nextStatus = action === RESOLVE_ACTIONS.REMOVE_RATING ? REPORT_STATUSES.RESOLVED : REPORT_STATUSES.DISMISSED;
      for (const rep of pendingOf(rating.id)) Object.assign(rep, { status: nextStatus, adminNote: adminNote ?? null, resolvedBy: adminId, updatedAt: stamp() });
      let summary;
      if (action === RESOLVE_ACTIONS.DISMISS) {
        rating.isFlagged = false;
        summary = summaryOf(tours.get(rating.tourId));
      } else if (!rating.isHidden) {
        rating.isHidden = true;
        summary = move(rating.tourId, ratingDelta.deleted(rating.stars));
      } else {
        summary = summaryOf(tours.get(rating.tourId));
      }
      return { report: target, status: nextStatus, summary };
    },
  };

  const statsRepo = {
    // one statement in SQL: insert the mark (unique + daily cap), add to the day row only on a new mark
    async recordActivity({ tourId, actorKey, action, language, day, cap }) {
      const mark = [tourId, actorKey, action, language, day].join('|');
      const today = [...marks].filter((m) => m.split('|')[1] === actorKey && m.split('|')[4] === day).length;
      if (today >= cap || marks.has(mark)) return false;
      marks.add(mark);
      const k = `${tourId}|${day}|${language}`;
      const row = daily.get(k) ?? { tourId, day, language, views: 0, plays: 0, completions: 0, downloads: 0 };
      row[ACTIVITY_COUNTERS[action]] += 1;
      daily.set(k, row);
      return true;
    },
    async dailyStats(tourId, { from, to, language }) {
      const byDay = new Map();
      for (const r of daily.values()) {
        if (r.tourId !== tourId || r.day < from || r.day > to || (language && r.language !== language)) continue;
        const d = byDay.get(r.day) ?? { day: r.day, views: 0, plays: 0, completions: 0, downloads: 0 };
        for (const c of Object.values(ACTIVITY_COUNTERS)) d[c] += r[c];
        byDay.set(r.day, d);
      }
      return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    },
    // like PrismaTourStatsRepository.latestComments: where { tourId, comment not null, is_hidden false }
    async latestComments(tourId, { take }) {
      const rows = [...ratings.values()].filter((r) => r.tourId === tourId && r.comment && !r.isHidden).sort((a, b) => b.createdAt - a.createdAt);
      return { items: rows.slice(0, take).map((r) => ({ id: r.id, userName: r.userName, stars: r.stars, comment: r.comment, createdAt: r.createdAt })), total: rows.length };
    },
  };

  return { tours, ratings, reports, marks, visible, tourRepo, ratingRepo, reportRepo, statsRepo };
}

// --- the real wiring of container.js (ratings, rating reports, stats) behind one express app ---
async function withScenario(fn) {
  const clock = { at: new Date('2026-11-10T09:00:00Z') };
  const now = () => clock.at;
  const store = fakeStore();
  const { tourRepo, ratingRepo, reportRepo, statsRepo } = store;

  // Stand-in for shared verifyJwt(roles): "Bearer <sub>:<role>:<name>".
  const verifyJwt = (roles = []) => (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const [sub, role, name] = h.slice(7).split(':');
    if (roles.length && !roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    req.user = { sub, role, ...(name ? { name: decodeURIComponent(name) } : {}) };
    next();
  };
  const reportController = new TourRatingReportController({
    submitRatingReport: new SubmitRatingReport({ tourRepo, reportRepo }),
    listAdminRatingReports: new ListAdminRatingReports({ reportRepo }),
    resolveRatingReport: new ResolveRatingReport({ reportRepo }),
  });
  const app = express();
  app.use(express.json());
  app.use('/admin/rating-reports', buildAdminRatingReportRouter({ tourRatingReportController: reportController, requireAdmin: verifyJwt(['admin']) }));
  app.use('/', buildTourRatingRouter({
    tourRatingController: new TourRatingController({
      listTourRatings: new ListTourRatings({ tourRepo, ratingRepo }),
      listMyTourRatings: new ListMyTourRatings({ ratingRepo }),
      getMyTourRating: new GetMyTourRating({ tourRepo, ratingRepo }),
      saveMyTourRating: new SaveMyTourRating({ tourRepo, ratingRepo }),
      deleteMyTourRating: new DeleteMyTourRating({ tourRepo, ratingRepo }),
    }),
    requireAuth: verifyJwt(),
  }));
  app.use('/', buildTourRatingReportRouter({ tourRatingReportController: reportController, requireAuth: verifyJwt() }));
  app.use('/', buildTourStatsRouter({
    tourStatsController: new TourStatsController({
      recordTourActivity: new RecordTourActivity({ tourRepo, statsRepo, salt: 'test-salt', now }),
      getTourStats: new GetTourStats({ tourRepo, statsRepo, ratingRepo, now }),
    }),
    optionalAuth: optionalAuth(verifyJwt()),
    requireOwnerRole: verifyJwt(['contributor', 'admin']),
  }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { as, body } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (as) headers.authorization = `Bearer ${as.sub}:${as.role}:${encodeURIComponent(as.name)}`;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const steps = {
    rate: (who, stars, comment) => call('PUT', `/${TOUR}/ratings/mine`, { as: who, body: { stars, ...(comment ? { comment } : {}) } }),
    unrate: (who) => call('DELETE', `/${TOUR}/ratings/mine`, { as: who }),
    list: () => call('GET', `/${TOUR}/ratings?page=1&limit=20`),
    report: (who, target, reasonType = 'OFFENSIVE') => call('POST', `/${TOUR}/ratings/${target.sub}/reports`, { as: who, body: { reasonType } }),
    queue: (status = 'pending', who = U.admin) => call('GET', `/admin/rating-reports?status=${status}`, { as: who }),
    resolve: (reportId, action) => call('POST', `/admin/rating-reports/${reportId}/resolve`, { as: U.admin, body: { action, adminNote: 'Đã xem xét' } }),
    beacon: (body, who) => call('POST', `/${TOUR}/activity`, { as: who, body }),
    stats: (who = U.author, id = TOUR, q = '') => call('GET', `/mine/${id}/stats${q}`, { as: who }),
  };
  try {
    await fn({ store, clock, call, ...steps });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

/** v1 (1 star, abusive comment) and v2 (5 stars) rate; three users report v1, the 3rd soft-flags it. */
async function ratedAndReported(s) {
  assert.equal((await s.rate(U.v1, 1, 'Nội dung xúc phạm')).status, 201);
  assert.equal((await s.rate(U.v2, 5, 'Rất hay')).status, 201);
  const first = await s.report(U.r1, U.v1, 'SPAM');
  assert.equal(first.status, 201);
  assert.equal(first.body.isFlagged, false);
  const dispute = await s.report(U.author, U.v1, 'MISLEADING'); // author dispute (A1)
  assert.equal(dispute.body.report.reporterRole, 'AUTHOR');
  const third = await s.report(U.r2, U.v1);
  assert.deepEqual([third.status, third.body.pendingCount, third.body.isFlagged], [201, SOFT_FLAG_THRESHOLD, true]);
  return { reportId: dispute.body.report.id };
}

/** UC05 post-condition: the aggregate matches the seed plus the ratings still shown. */
function assertAggregateMatchesVisible(store) {
  const rows = store.visible(TOUR);
  assertSummary(store.tours.get(TOUR), rows.reduce((n, r) => n + r.stars, 0), rows.length);
}

// ---------- UC05: rate ----------
test('UC05 a public tour starts from its seeded aggregate; reading is anonymous and hides user ids', () => withScenario(async (s) => {
  const start = await s.list();
  assert.equal(start.status, 200);
  assert.deepEqual(start.body.summary, { ...SEED, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  assert.deepEqual([start.body.items, start.body.total], [[], 0]);
  assert.equal((await s.call('GET', `/${TOUR}/ratings/mine`)).status, 401); // "mine" needs sign-in
  assert.equal((await s.call('GET', `/${DRAFT}/ratings`)).status, 404); // R4

  await s.rate(U.v1, 4, 'Ổn');
  const after = await s.list();
  assert.equal(after.body.items.length, 1);
  assert.equal(after.body.items[0].userName, 'An');
  assert.equal(after.body.items[0].userId, undefined);
  assert.ok(!JSON.stringify(after.body).includes(U.v1.sub));
}));

test('UC05 several visitors rate: the aggregate moves exactly from the seeded values', () => withScenario(async (s) => {
  assertSummary((await s.rate(U.v1, 5)).body.summary, 5, 1);
  assertSummary((await s.rate(U.v2, 4)).body.summary, 9, 2);
  const third = await s.rate(U.v3, 1, 'Chán');
  assert.equal(third.status, 201);
  assertSummary(third.body.summary, 10, 3);

  const { body } = await s.list();
  assertSummary(body.summary, 10, 3);
  assert.deepEqual(body.summary.distribution, { 1: 1, 2: 0, 3: 0, 4: 1, 5: 1 }); // rating rows only, not the seed
  assert.deepEqual(body.items.map((i) => i.userName), ['Chi', 'Bình', 'An']); // newest first
}));

test('UC05 the author cannot rate their own tour; anonymous, invalid and draft ratings change nothing', () => withScenario(async (s) => {
  const own = await s.rate(U.author, 5);
  assert.deepEqual([own.status, own.body.code], [403, 'own_tour']);
  assert.equal((await s.call('PUT', `/${TOUR}/ratings/mine`, { body: { stars: 5 } })).status, 401);
  assert.equal((await s.rate(U.v1, 0)).status, 400);
  assert.equal((await s.call('PUT', `/${DRAFT}/ratings/mine`, { as: U.v1, body: { stars: 5 } })).status, 404);
  assert.equal(s.store.ratings.size, 0);
  assert.deepEqual((await s.list()).body.summary, { ...SEED, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
}));

test('UC05 one rating per account: a second rating edits it and keeps the count', () => withScenario(async (s) => {
  await s.rate(U.v1, 5, 'Tuyệt');
  await s.rate(U.v2, 3);
  const edit = await s.rate(U.v1, 2, 'Đổi ý');
  assert.equal(edit.status, 200);
  assertSummary(edit.body.summary, 5, 2); // 2 + 3
  assert.equal(s.store.ratings.size, 2);
  const mine = await s.call('GET', `/${TOUR}/ratings/mine`, { as: U.v1 });
  assert.deepEqual([mine.body.rating.stars, mine.body.rating.comment], [2, 'Đổi ý']);
  assert.equal((await s.list()).body.total, 2);
}));

test('UC05 delete: the aggregate goes back exactly, a second delete is 404, the seed comes back', () => withScenario(async (s) => {
  await s.rate(U.v1, 5);
  await s.rate(U.v2, 2);
  const del = await s.unrate(U.v2);
  assert.equal(del.status, 204);
  assertSummary(s.store.tours.get(TOUR), 5, 1);
  assert.equal((await s.unrate(U.v2)).status, 404);
  await s.unrate(U.v1);
  const { body } = await s.list();
  assertSummary(body.summary, 0, 0);
  assert.equal(body.total, 0);
}));

// ---------- UC05: report -> admin ----------
test('UC05 report: three reports soft-flag a rating; it stays public and counted; self and duplicate reports refused', () => withScenario(async (s) => {
  await ratedAndReported(s);
  const self = await s.report(U.v1, U.v1);
  assert.deepEqual([self.status, self.body.code], [400, 'cannot_report_own_rating']);
  const dup = await s.report(U.r1, U.v1);
  assert.deepEqual([dup.status, dup.body.code], [409, 'report_already_submitted']);
  assert.equal((await s.call('POST', `/${TOUR}/ratings/${U.v1.sub}/reports`, { body: { reasonType: 'SPAM' } })).status, 401);

  const { body } = await s.list();
  assert.equal(body.total, 2); // a flag does not hide
  assertSummary(body.summary, 6, 2);
}));

test('UC05 admin REMOVE_RATING hides the rating and takes it out of the aggregate exactly', () => withScenario(async (s) => {
  const { reportId } = await ratedAndReported(s);
  assert.equal((await s.queue('pending', U.r1)).status, 403);
  assert.equal((await s.call('GET', '/admin/rating-reports')).status, 401);
  const queue = await s.queue();
  assert.equal(queue.body.total, 3);
  assert.equal(queue.body.items[0].reporterRole, 'AUTHOR'); // author dispute first among flagged
  assert.equal(queue.body.items[0].rating.isFlagged, true);

  const removed = await s.resolve(reportId, 'REMOVE_RATING');
  assert.equal(removed.status, 200);
  assert.equal(removed.body.status, 'RESOLVED');
  assertSummary(removed.body.summary, 5, 1); // only v2 left on top of the seed

  const { body } = await s.list();
  assert.deepEqual(body.items.map((i) => i.userName), ['Bình']);
  assert.deepEqual(body.summary.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 });
  assertSummary(body.summary, 5, 1);
  assert.equal((await s.queue()).body.total, 0);
  assert.equal((await s.queue('resolved')).body.total, 3); // every pending report of the rating
  assert.equal((await s.call('GET', `/${TOUR}/ratings/mine`, { as: U.v1 })).body.rating, null);
  const late = await s.report(U.v3, U.v1);
  assert.deepEqual([late.status, late.body.code], [404, 'rating_not_found']);
}));

test('UC05 admin DISMISS keeps the rating visible and counted and clears the flag', () => withScenario(async (s) => {
  const { reportId } = await ratedAndReported(s);
  const dismissed = await s.resolve(reportId, 'DISMISS');
  assert.equal(dismissed.body.status, 'DISMISSED');
  assertSummary(dismissed.body.summary, 6, 2);
  assert.equal(s.store.visible(TOUR).find((r) => r.userId === U.v1.sub).isFlagged, false);
  assert.equal((await s.list()).body.total, 2);
  assert.equal((await s.queue('dismissed')).body.total, 3);
  assert.equal((await s.queue()).body.total, 0);
}));

test('UC05 resolving an already removed rating again does not move the aggregate; unknown report is 404', () => withScenario(async (s) => {
  const { reportId } = await ratedAndReported(s);
  await s.resolve(reportId, 'REMOVE_RATING');
  const again = await s.resolve(reportId, 'REMOVE_RATING');
  assert.equal(again.status, 200);
  assertSummary(again.body.summary, 5, 1);
  const unknown = await s.resolve(crypto.randomUUID(), 'DISMISS');
  assert.deepEqual([unknown.status, unknown.body.code], [404, 'rating_report_not_found']);
}));

// A removed rating is out of the aggregate: rating again replaces it and counts it once.
test('UC05 the owner of a removed rating rates again: aggregate should match the shown ratings', () => withScenario(async (s) => {
  const { reportId } = await ratedAndReported(s);
  await s.resolve(reportId, 'REMOVE_RATING');
  await s.rate(U.v1, 4);
  assertAggregateMatchesVisible(s.store);
}));

// Deleting a removed rating is 404 and does not subtract its stars a second time.
test('UC05 the owner deletes a removed rating: aggregate should not drop a second time', () => withScenario(async (s) => {
  const { reportId } = await ratedAndReported(s);
  await s.resolve(reportId, 'REMOVE_RATING');
  await s.unrate(U.v1);
  assertAggregateMatchesVisible(s.store);
}));

// ---------- UC17: statistics ----------
test('UC17 beacons count once per device (or account), tour, action and day; anonymous by device id', () => withScenario(async (s) => {
  for (let i = 0; i < 3; i += 1) assert.equal((await s.beacon({ action: 'view', deviceId: DEVICE_A })).status, 204);
  for (const action of ['play', 'complete', 'download']) await s.beacon({ action, deviceId: DEVICE_A });
  await s.beacon({ action: 'view', deviceId: DEVICE_B });
  await s.beacon({ action: 'play', deviceId: DEVICE_B });
  await s.beacon({ action: 'view', deviceId: DEVICE_A }, U.v1); // signed in: counted by account
  await s.beacon({ action: 'view', deviceId: DEVICE_B }, U.v1); // same account, other device: not again
  assert.equal((await s.beacon({ action: 'view' })).status, 400); // anonymous needs a device id
  assert.equal((await s.call('POST', `/${DRAFT}/activity`, { body: { action: 'view', deviceId: DEVICE_A } })).status, 204);
  assert.ok(![...s.store.marks].some((m) => m.startsWith(DRAFT)));
  assert.ok(![...s.store.marks].some((m) => m.includes(DEVICE_A))); // actor key is hashed

  let { body } = await s.stats();
  assert.deepEqual(body.totals, { views: 3, plays: 2, completions: 1, downloads: 1, completionRate: 0.5 });

  s.clock.at = new Date('2026-11-11T00:00:05Z'); // next UTC day counts again
  await s.beacon({ action: 'view', deviceId: DEVICE_A });
  await s.beacon({ action: 'view', deviceId: DEVICE_A, language: 'en' });
  ({ body } = await s.stats());
  assert.deepEqual(body.daily.map((d) => [d.day, d.views]), [['2026-11-10', 3], ['2026-11-11', 2]]);
  assert.equal((await s.stats(U.author, TOUR, '?language=en')).body.totals.views, 1);
}));

test('UC17 only the author or an admin sees the stats; another contributor cannot', () => withScenario(async (s) => {
  await s.beacon({ action: 'view', deviceId: DEVICE_A });
  assert.equal((await s.stats()).status, 200);
  const other = await s.stats(U.other);
  assert.deepEqual([other.status, other.body.code], [403, 'not_tour_owner']);
  assert.equal((await s.stats(U.v1)).status, 403); // tourist role stopped by verifyJwt
  assert.equal((await s.call('GET', `/mine/${TOUR}/stats`)).status, 401);
  const admin = await s.stats(U.admin);
  assert.deepEqual([admin.status, admin.body.totals.views], [200, 1]);
  assert.equal((await s.stats(U.other, OTHER_TOUR)).status, 200); // their own tour
}));

test('UC17 the stats rating block follows the UC05 aggregate through rate, edit and admin removal', () => withScenario(async (s) => {
  const ratingsOf = async () => (await s.stats()).body.ratings;
  assert.deepEqual(await ratingsOf(), { ...SEED, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });

  const { reportId } = await ratedAndReported(s);
  await s.rate(U.v3, 3);
  await s.rate(U.v3, 4); // edit
  assert.deepEqual(await ratingsOf(), (await s.list()).body.summary);
  assertSummary(await ratingsOf(), 10, 3);

  await s.resolve(reportId, 'REMOVE_RATING');
  const after = await ratingsOf();
  assert.deepEqual(after, (await s.list()).body.summary);
  assertSummary(after, 9, 2);
  assert.deepEqual(after.distribution, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 });
}));

// UC05 report doc: UC17 stats leave out comments the admin removed.
test('UC17 a comment removed by the admin should leave the author stats comments', () => withScenario(async (s) => {
  const { reportId } = await ratedAndReported(s);
  await s.resolve(reportId, 'REMOVE_RATING');
  const { comments } = (await s.stats()).body;
  assert.deepEqual(comments.items.map((c) => c.comment), ['Rất hay']);
  assert.equal(comments.total, 1);
}));
