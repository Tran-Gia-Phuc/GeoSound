// =========================================================
// UC19 (#243) — admin review queue, dossier and decisions (approve / reject / request changes).
// Fakes only: no DB, no broker. Published payloads are validated with the shared zod contract
// (test/helpers/shared-events.js). The router is tested over a local HTTP server on 127.0.0.1.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

import { validateEvent, EVENTS } from './helpers/shared-events.js';
import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { Place } from '../src/domain/entities/place.js';
import { RouteConfig } from '../src/domain/entities/route-config.js';
import { TourReviewAction } from '../src/domain/entities/tour-review-action.js';
import {
  ListReviewQueue,
  GetReviewDossier,
  ApproveTour,
  RejectTour,
  RequestTourChanges,
  sortReviewQueue,
} from '../src/application/use-cases/review-tour.js';
import { PublishTour } from '../src/application/use-cases/publish-tour.js';
import { EventTourReviewPublisher } from '../src/infrastructure/messaging/event-tour-review-publisher.js';
import { EventTourCatalogPublisher } from '../src/infrastructure/messaging/event-tour-catalog-publisher.js';
import { AdminReviewController } from '../src/interfaces/http/controllers/admin-review-controller.js';
import { buildAdminReviewRouter } from '../src/interfaces/http/routes/admin-review-routes.js';

// --- fakes ---
let tick = Date.parse('2026-01-01T00:00:00.000Z');
const nextDate = () => new Date((tick += 1000));
const clock = () => new Date((tick += 1000));

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const T4 = '44444444-4444-4444-8444-444444444444';
const MISSING = '99999999-9999-4999-8999-999999999999';

function fakeTourRepo(seed = []) {
  const rows = new Map(seed.map((t) => [t.id, t]));
  const log = [];
  return {
    rows,
    log,
    // Set to a status to simulate another write landing between the read and the conditional write.
    raceTo: null,
    async findById(id) { return rows.get(id) ?? null; },
    async save(t) { t.updatedAt = nextDate(); rows.set(t.id, t); return t; },
    async listByStatuses(statuses) {
      return [...rows.values()]
        .filter((t) => statuses.includes(t.status))
        .sort((a, b) => a.updatedAt - b.updatedAt);
    },
    async applyReviewDecisionIf(id, fromStatuses, { status, reviewReason }, entry) {
      const t = rows.get(id);
      if (this.raceTo) t.status = this.raceTo;
      if (!t || !fromStatuses.includes(t.status)) return 0;
      Object.assign(t, { status, reviewReason, updatedAt: nextDate() });
      log.push(new TourReviewAction({ id: `a${log.length + 1}`, tourId: id, ...entry, createdAt: nextDate() }));
      return 1;
    },
  };
}

function fakePlaceRepo(seed = []) {
  const rows = new Map(seed.map((p) => [p.id, p]));
  return {
    rows,
    async listByTour(tourId) {
      return [...rows.values()].filter((p) => p.tourId === tourId).sort((a, b) => a.sequence - b.sequence);
    },
  };
}

const fakeReviewActionRepo = (tourRepo) => ({
  async listByTour(tourId) { return tourRepo.log.filter((a) => a.tourId === tourId).reverse(); },
});

function fakePublisher() {
  const events = [];
  const pub = async (eventName, payload) => { events.push({ eventName, payload: validateEvent(eventName, payload) }); };
  pub.events = events;
  return pub;
}
const failingPublisher = async () => { throw new Error('RabbitMQ chưa connect()'); };

function fakeLogger() {
  const lines = [];
  return { lines, info: (m) => lines.push(['info', m]), error: (m) => lines.push(['error', m]), warn: (m) => lines.push(['warn', m]) };
}

const tour = (id, props = {}) =>
  new Tour({ id, title: `Tour ${id.slice(0, 4)}`, description: 'Đi bộ phố cổ', originalLanguage: 'vi', authorId: 'u1',
    type: 'walking', status: TOUR_STATUS.PENDING_REVIEW, city: 'Hội An', duration: 90, updatedAt: nextDate(), ...props });
const place = (id, tourId, sequence, props = {}) =>
  new Place({ id, tourId, name: `Điểm ${id}`, description: 'Mô tả', lat: 15.877, lng: 108.326, sequence,
    images: [{ url: 'https://img.example.com/a.jpg' }], audioUrl: 'https://audio.example.com/a.mp3',
    updatedAt: nextDate(), ...props });

function setup({ tours = [tour(T1)], places = [], publish = fakePublisher(), chatbot = true, events = true } = {}) {
  const tourRepo = fakeTourRepo(tours);
  const placeRepo = fakePlaceRepo(places);
  const logger = fakeLogger();
  const deps = {
    tourRepo,
    placeRepo,
    reviewEvents: events ? new EventTourReviewPublisher({ publish, clock }) : null,
    catalog: chatbot ? new EventTourCatalogPublisher({ publish, clock, logger }) : null,
    logger,
  };
  return { tourRepo, placeRepo, logger, publish, deps };
}
const names = (pub) => (pub.events ?? []).map((e) => e.eventName);

// ---------- queue ----------

test('queue: ai_warning first, then oldest submission first; other statuses left out', async () => {
  const old = tour(T1, { status: TOUR_STATUS.PENDING_REVIEW, updatedAt: new Date('2026-01-01T00:00:00Z') });
  const newWarn = tour(T2, { status: TOUR_STATUS.AI_WARNING, updatedAt: new Date('2026-01-03T00:00:00Z') });
  const oldWarn = tour(T3, { status: TOUR_STATUS.AI_WARNING, updatedAt: new Date('2026-01-02T00:00:00Z') });
  const draft = tour(T4, { status: TOUR_STATUS.DRAFT, updatedAt: new Date('2025-01-01T00:00:00Z') });
  const s = setup({ tours: [old, newWarn, oldWarn, draft] });
  const queue = await new ListReviewQueue(s.deps).execute();
  assert.deepEqual(queue.map((q) => q.id), [T3, T2, T1]);
  assert.deepEqual(queue.map((q) => q.aiWarning), [true, true, false]);
  assert.equal(queue[0].submittedAt.toISOString(), '2026-01-02T00:00:00.000Z');
  assert.ok(Array.isArray(queue[0].moderationReasons));
});

test('queue: empty list when nothing waits (E1)', async () => {
  const s = setup({ tours: [tour(T1, { status: TOUR_STATUS.PUBLIC }), tour(T2, { status: TOUR_STATUS.DRAFT })] });
  assert.deepEqual(await new ListReviewQueue(s.deps).execute(), []);
});

test('sortReviewQueue is pure and does not mutate its input', () => {
  const a = { status: TOUR_STATUS.PENDING_REVIEW, updatedAt: new Date(1) };
  const b = { status: TOUR_STATUS.AI_WARNING, updatedAt: new Date(2) };
  const input = [a, b];
  assert.deepEqual(sortReviewQueue(input), [b, a]);
  assert.deepEqual(input, [a, b]);
});

// ---------- dossier ----------

test('dossier: tour, ordered places with media and moderation, reasons, route config, history', async () => {
  const reasons = [{ field: 'description', category: 'misleading', message: 'm', source: 'ai', severity: 0.5 }];
  const s = setup({
    tours: [tour(T1, { status: TOUR_STATUS.AI_WARNING, moderationReasons: reasons })],
    places: [
      place('p2', T1, 1, { moderationStatus: 'warning', moderationReasons: reasons }),
      place('p1', T1, 0),
      place('px', T2, 0),
    ],
  });
  const routeConfigRepo = {
    async findByTour(id) { return new RouteConfig({ tourId: id, path: [{ lat: 1, lng: 2 }], triggers: [], navAudios: [] }); },
  };
  s.tourRepo.log.push(new TourReviewAction({ id: 'a0', tourId: T1, adminId: 'adm', action: 'request_changes',
    reason: 'old', fromStatus: 'pending_review', createdAt: nextDate() }));
  const d = await new GetReviewDossier({ ...s.deps, reviewActionRepo: fakeReviewActionRepo(s.tourRepo), routeConfigRepo })
    .execute({ tourId: T1 });
  assert.equal(d.tour.id, T1);
  assert.equal(d.tour.aiWarning, true);
  assert.deepEqual(d.tour.moderationReasons, reasons);
  assert.equal(d.reviewable, true);
  assert.deepEqual(d.places.map((p) => p.id), ['p1', 'p2']);
  assert.equal(d.places[0].audioUrl, 'https://audio.example.com/a.mp3');
  assert.equal(d.places[0].images.length, 1);
  assert.equal(d.places[1].moderationStatus, 'warning');
  assert.deepEqual(d.places[1].moderationReasons, reasons);
  assert.deepEqual(d.routeConfig.path, [{ lat: 1, lng: 2 }]);
  assert.equal(d.history.length, 1);
  assert.equal(d.history[0].action, 'request_changes');
});

test('dossier: 404 for an unknown tour; null route config when none', async () => {
  const s = setup();
  const uc = new GetReviewDossier({ ...s.deps, reviewActionRepo: fakeReviewActionRepo(s.tourRepo),
    routeConfigRepo: { async findByTour() { return null; } } });
  await assert.rejects(uc.execute({ tourId: MISSING }), (e) => e.status === 404);
  const d = await uc.execute({ tourId: T1 });
  assert.equal(d.routeConfig, null);
  assert.deepEqual(d.history, []);
});

// ---------- approve ----------

test('approve: public, log row, tour.approved + tour.published valid against the shared contract', async () => {
  const s = setup({
    tours: [tour(T1, { status: TOUR_STATUS.AI_WARNING, reviewReason: 'old reason' })],
    places: [place('p1', T1, 0), place('p2', T1, 1, { moderationStatus: 'rejected' })],
  });
  const res = await new ApproveTour(s.deps).execute({ tourId: T1, adminId: 'adm1' });
  assert.equal(res.tour.status, TOUR_STATUS.PUBLIC);
  assert.equal(res.tour.reviewReason, null);
  assert.equal(res.action, 'approve');
  assert.equal(s.tourRepo.log.length, 1);
  assert.deepEqual(
    { ...s.tourRepo.log[0].toPublic(), id: undefined, createdAt: undefined },
    { id: undefined, tourId: T1, adminId: 'adm1', action: 'approve', reason: null, fromStatus: 'ai_warning', createdAt: undefined },
  );
  assert.deepEqual(names(s.publish), [EVENTS.TOUR_APPROVED, EVENTS.TOUR_PUBLISHED]);
  const approved = s.publish.events[0].payload;
  assert.equal(approved.tourId, T1);
  assert.equal(approved.adminId, 'adm1');
  assert.equal(approved.contributorId, 'u1');
  assert.equal(approved.tourTitle, s.tourRepo.rows.get(T1).title);
  assert.match(approved.at, /Z$/);
  const published = s.publish.events[1].payload;
  assert.equal(published.status, 'public');
  assert.deepEqual(published.places.map((p) => p.placeId), ['p1']); // rejected place never indexed
});

test('approve with the chatbot flag off: only tour.approved', async () => {
  const s = setup({ places: [place('p1', T1, 0)], chatbot: false });
  await new ApproveTour(s.deps).execute({ tourId: T1, adminId: 'adm1' });
  assert.deepEqual(names(s.publish), [EVENTS.TOUR_APPROVED]);
});

test('approve with no broker (reviewEvents and catalog null): still decided and logged', async () => {
  const s = setup({ events: false, chatbot: false });
  const res = await new ApproveTour(s.deps).execute({ tourId: T1, adminId: 'adm1' });
  assert.equal(res.tour.status, TOUR_STATUS.PUBLIC);
  assert.equal(s.tourRepo.log.length, 1);
  assert.deepEqual(names(s.publish), []);
});

// ---------- reject / request changes ----------

test('reject: rejected with the reason stored, log row, tour.rejected valid', async () => {
  const s = setup();
  const res = await new RejectTour(s.deps).execute({ tourId: T1, adminId: 'adm1', reason: 'Nội dung trùng lặp' });
  assert.equal(res.tour.status, TOUR_STATUS.REJECTED);
  assert.equal(res.tour.reviewReason, 'Nội dung trùng lặp');
  assert.equal(s.tourRepo.log[0].action, 'reject');
  assert.equal(s.tourRepo.log[0].reason, 'Nội dung trùng lặp');
  assert.equal(s.tourRepo.log[0].fromStatus, 'pending_review');
  assert.deepEqual(names(s.publish), [EVENTS.TOUR_REJECTED]);
  const p = s.publish.events[0].payload;
  assert.equal(p.reason, 'Nội dung trùng lặp');
  assert.equal(p.contributorId, 'u1');
  assert.match(p.at, /Z$/);
});

test('request changes: changes_requested, log row, tour.changes_requested valid; author can resubmit', async () => {
  const s = setup({ places: [place('p1', T1, 0)] });
  const res = await new RequestTourChanges(s.deps).execute({ tourId: T1, adminId: 'adm1', reason: 'Thêm ảnh cho điểm 1' });
  assert.equal(res.tour.status, TOUR_STATUS.CHANGES_REQUESTED);
  assert.equal(res.tour.reviewReason, 'Thêm ảnh cho điểm 1');
  assert.equal(s.tourRepo.log[0].action, 'request_changes');
  assert.deepEqual(names(s.publish), [EVENTS.TOUR_CHANGES_REQUESTED]);
  assert.equal(s.publish.events[0].payload.reason, 'Thêm ảnh cho điểm 1');

  const t = s.tourRepo.rows.get(T1);
  assert.equal(t.isLive(), false);
  assert.equal(t.canPublish(), true);
  assert.equal(t.isReviewable(), false);
  // UC15 resubmit (direct publish path here: no moderation gateway).
  const pub = await new PublishTour({ tourRepo: s.tourRepo, placeRepo: s.placeRepo }).execute({ authorId: 'u1', tourId: T1 });
  assert.equal(pub.changed, true);
});

// ---------- conflicts / not found / publish failure ----------

test('409 when the tour is not reviewable; nothing logged or published', async () => {
  for (const status of [TOUR_STATUS.DRAFT, TOUR_STATUS.AI_CHECKING, TOUR_STATUS.PUBLIC, TOUR_STATUS.REJECTED,
    TOUR_STATUS.CHANGES_REQUESTED, TOUR_STATUS.HIDDEN]) {
    const s = setup({ tours: [tour(T1, { status })] });
    await assert.rejects(new ApproveTour(s.deps).execute({ tourId: T1, adminId: 'a' }), (e) => e.status === 409);
    await assert.rejects(new RejectTour(s.deps).execute({ tourId: T1, adminId: 'a', reason: 'x' }), (e) => e.status === 409);
    await assert.rejects(new RequestTourChanges(s.deps).execute({ tourId: T1, adminId: 'a', reason: 'x' }), (e) => e.status === 409);
    assert.equal(s.tourRepo.log.length, 0);
    assert.deepEqual(names(s.publish), []);
  }
});

test('409 when the conditional write loses the race (status changed after the read)', async () => {
  const s = setup();
  s.tourRepo.raceTo = TOUR_STATUS.DRAFT; // e.g. the author edited the tour meanwhile
  await assert.rejects(
    new ApproveTour(s.deps).execute({ tourId: T1, adminId: 'a' }),
    (e) => e.status === 409 && e.code === 'tour_not_reviewable',
  );
  assert.equal(s.tourRepo.log.length, 0);
  assert.deepEqual(names(s.publish), []);
});

test('a second decision on the same tour gets 409', async () => {
  const s = setup();
  await new RejectTour(s.deps).execute({ tourId: T1, adminId: 'a', reason: 'x' });
  await assert.rejects(new ApproveTour(s.deps).execute({ tourId: T1, adminId: 'b' }), (e) => e.status === 409);
  assert.equal(s.tourRepo.log.length, 1);
});

test('404 for an unknown tour', async () => {
  const s = setup();
  await assert.rejects(new ApproveTour(s.deps).execute({ tourId: MISSING, adminId: 'a' }), (e) => e.status === 404);
  await assert.rejects(new RejectTour(s.deps).execute({ tourId: MISSING, adminId: 'a', reason: 'x' }), (e) => e.status === 404);
});

test('publish failure never fails the decision (logged only)', async () => {
  const s = setup({ places: [place('p1', T1, 0)], publish: failingPublisher });
  const res = await new ApproveTour(s.deps).execute({ tourId: T1, adminId: 'a' });
  assert.equal(res.tour.status, TOUR_STATUS.PUBLIC);
  assert.equal(s.tourRepo.log.length, 1);
  const errors = s.logger.lines.filter(([lvl]) => lvl === 'error').map(([, m]) => m);
  assert.ok(errors.some((m) => m.includes('tour.approved not sent')));
  assert.ok(errors.some((m) => m.includes('tour.published not sent')));

  const s2 = setup({ tours: [tour(T2)], publish: failingPublisher });
  const res2 = await new RequestTourChanges(s2.deps).execute({ tourId: T2, adminId: 'a', reason: 'x' });
  assert.equal(res2.tour.status, TOUR_STATUS.CHANGES_REQUESTED);
});

test('review publisher cuts a long reason to the contract limit', async () => {
  const publish = fakePublisher();
  const p = await new EventTourReviewPublisher({ publish, clock }).rejected(tour(T1), 'x'.repeat(1500));
  assert.equal(p.reason.length, 1000);
});

// ---------- HTTP router (local server, guard injected) ----------

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function signJwt(payload, secret) {
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ iat: Math.floor(Date.now() / 1000), ...payload });
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

// Same rules as shared verifyJwt: 401 without a token, 403 for another role. Token = "role:<r>".
const fakeGuard = (roles) => (req, res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const role = h.slice(7).replace('role:', '');
  if (!roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
  req.user = { sub: 'adm1', role };
  next();
};

async function withServer(requireAdmin, s, fn) {
  const reviewActionRepo = fakeReviewActionRepo(s.tourRepo);
  const controller = new AdminReviewController({
    listReviewQueue: new ListReviewQueue(s.deps),
    getReviewDossier: new GetReviewDossier({ ...s.deps, reviewActionRepo }),
    approveTour: new ApproveTour(s.deps),
    rejectTour: new RejectTour(s.deps),
    requestTourChanges: new RequestTourChanges(s.deps),
  });
  const app = express();
  app.use(express.json());
  app.use('/admin/reviews', buildAdminReviewRouter({ adminReviewController: controller, requireAdmin }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/admin/reviews`;
  try {
    await fn(async (path, { method = 'GET', token, body } = {}) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('router: every route is behind the guard (401 without token, 403 for a contributor)', async () => {
  const s = setup();
  await withServer(fakeGuard(['admin']), s, async (call) => {
    const routes = [
      ['GET', ''], ['GET', `/${T1}`], ['POST', `/${T1}/approve`],
      ['POST', `/${T1}/reject`], ['POST', `/${T1}/request-changes`],
    ];
    for (const [method, path] of routes) {
      assert.equal((await call(path, { method, body: method === 'POST' ? { reason: 'x' } : undefined })).status, 401);
      assert.equal((await call(path, { method, token: 'role:contributor', body: method === 'POST' ? { reason: 'x' } : undefined })).status, 403);
    }
  });
  assert.equal(s.tourRepo.rows.get(T1).status, TOUR_STATUS.PENDING_REVIEW);
  assert.equal(s.tourRepo.log.length, 0);
});

test('router: queue, dossier, 422 without reason, 404, 409, decisions', async () => {
  const s = setup({ tours: [tour(T1), tour(T2, { status: TOUR_STATUS.AI_WARNING })], places: [place('p1', T1, 0)] });
  await withServer(fakeGuard(['admin']), s, async (call) => {
    const admin = 'role:admin';
    const q = await call('', { token: admin });
    assert.equal(q.status, 200);
    assert.deepEqual(q.body.tours.map((t) => t.id), [T2, T1]);

    const d = await call(`/${T1}`, { token: admin });
    assert.equal(d.status, 200);
    assert.equal(d.body.places.length, 1);
    assert.equal((await call(`/${MISSING}`, { token: admin })).status, 404);
    assert.equal((await call('/not-a-uuid', { token: admin })).status, 400);

    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'x'.repeat(1001) }, { reason: 5 }]) {
      assert.equal((await call(`/${T1}/reject`, { method: 'POST', token: admin, body })).status, 422);
      assert.equal((await call(`/${T1}/request-changes`, { method: 'POST', token: admin, body })).status, 422);
    }
    assert.equal(s.tourRepo.log.length, 0);

    const rc = await call(`/${T1}/request-changes`, { method: 'POST', token: admin, body: { reason: '  Sửa mô tả  ' } });
    assert.equal(rc.status, 200);
    assert.equal(rc.body.tour.status, TOUR_STATUS.CHANGES_REQUESTED);
    assert.equal(rc.body.tour.reviewReason, 'Sửa mô tả');
    assert.equal(s.tourRepo.log[0].adminId, 'adm1');

    assert.equal((await call(`/${T1}/approve`, { method: 'POST', token: admin })).status, 409);
    const ap = await call(`/${T2}/approve`, { method: 'POST', token: admin });
    assert.equal(ap.status, 200);
    assert.equal(ap.body.tour.status, TOUR_STATUS.PUBLIC);
    assert.equal((await call(`/${MISSING}/reject`, { method: 'POST', token: admin, body: { reason: 'x' } })).status, 404);

    const q2 = await call('', { token: admin });
    assert.deepEqual(q2.body.tours, []);
  });
});

// Real shared verifyJwt when it can be loaded (needs jsonwebtoken, present in the Docker image).
async function loadSharedVerifyJwt() {
  for (const rel of ['../../../shared/middleware/index.js', '../shared/middleware/index.js']) {
    try {
      return (await import(new URL(rel, import.meta.url).href)).verifyJwt;
    } catch {
      // try the next layout
    }
  }
  return null;
}

test('router with the real shared verifyJwt: 401 / 403 / 200', async (t) => {
  const verifyJwt = await loadSharedVerifyJwt();
  if (!verifyJwt) return t.skip('shared middleware (jsonwebtoken) not available in this layout');
  const secret = 'test-secret-not-real';
  const previous = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = secret;
  try {
    const s = setup({ events: false, chatbot: false });
    await withServer(verifyJwt(['admin']), s, async (call) => {
      assert.equal((await call('')).status, 401);
      assert.equal((await call('', { token: 'garbage' })).status, 401);
      assert.equal((await call('', { token: signJwt({ sub: 'u1', role: 'contributor' }, secret) })).status, 403);
      const ok = await call('', { token: signJwt({ sub: 'adm1', role: 'admin' }, secret) });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.tours.length, 1);
    });
  } finally {
    if (previous === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previous;
  }
});
