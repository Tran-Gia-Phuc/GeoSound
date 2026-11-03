// =========================================================
// UC20 (#273) — admin handling of reported tours: queue, dossier, hide / restore / dismiss.
// Fakes only: no DB, no broker. Published payloads are validated with the shared zod contract
// (test/helpers/shared-events.js), including the new tour.restored. The router is tested over a
// local HTTP server on 127.0.0.1 with a stand-in for verifyJwt(['admin']).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { validateEvent, EVENTS } from './helpers/shared-events.js';
import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { Place } from '../src/domain/entities/place.js';
import { TourReport } from '../src/domain/entities/tour-report.js';
import {
  AdminAction,
  ADMIN_ACTION,
  assertAdminActionEntry,
  normalizeAdminReason,
} from '../src/domain/entities/admin-action.js';
import { compareReportQueue, availableReportActions } from '../src/domain/tour/report-handling.js';
import {
  ListReportQueue,
  GetReportDossier,
  HideReportedTour,
  RestoreHiddenTour,
  DismissTourReports,
} from '../src/application/use-cases/admin-reports.js';
import { EventAdminReportPublisher } from '../src/infrastructure/messaging/event-admin-report-publisher.js';
import { EventTourCatalogPublisher } from '../src/infrastructure/messaging/event-tour-catalog-publisher.js';
import { PrismaAdminActionRepository } from '../src/infrastructure/persistence/prisma-admin-action-repository.js';
import { AdminReportController } from '../src/interfaces/http/controllers/admin-report-controller.js';
import { buildAdminReportRouter } from '../src/interfaces/http/routes/admin-report-routes.js';

// --- ids / clock ---
let tick = Date.parse('2026-02-01T00:00:00.000Z');
const nextDate = () => new Date((tick += 1000));
const clock = () => new Date((tick += 1000));

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const T4 = '44444444-4444-4444-8444-444444444444';
const T5 = '55555555-5555-4555-8555-555555555555';
const MISSING = '99999999-9999-4999-8999-999999999999';

// --- fakes: one in-memory store behind tourRepo + adminReportRepo + adminActionRepo ---

function fakeStore({ tours = [], reports = [] } = {}) {
  const rows = new Map(tours.map((t) => [t.id, t]));
  const reportRows = [...reports];
  const log = [];
  const openOf = (id) => reportRows.filter((r) => r.tourId === id && r.status === 'open');

  const adminActionRepo = {
    log,
    async append(entry) {
      assertAdminActionEntry(entry);
      const row = new AdminAction({ id: `a${log.length + 1}`, ...entry, createdAt: nextDate() });
      log.push(row);
      return row;
    },
    async listByTarget(targetType, targetId) {
      return log.filter((a) => a.targetType === targetType && a.targetId === targetId).reverse();
    },
  };

  const tourRepo = {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
  };

  const adminReportRepo = {
    // Set to a status to simulate another admin's write landing between the read and the write.
    raceTo: null,
    async listQueue({ skip, take }) {
      const items = [...rows.values()]
        .filter((t) => t.openReportCount > 0)
        .map((t) => {
          const open = openOf(t.id).map((r) => r.createdAt.getTime());
          const reasons = {};
          for (const r of openOf(t.id)) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
          return {
            tourId: t.id, title: t.title, status: t.status, authorId: t.authorId,
            openReportCount: t.openReportCount, flaggedAt: t.flaggedAt ?? null,
            oldestReportAt: open.length ? new Date(Math.min(...open)) : null,
            lastReportAt: open.length ? new Date(Math.max(...open)) : null,
            reasons,
          };
        })
        .sort(compareReportQueue);
      return { items: items.slice(skip, skip + take), total: items.length };
    },
    async getReportState(id) {
      const t = rows.get(id);
      if (!t) return null;
      const counts = { open: 0, dismissed: 0, actioned: 0 };
      for (const r of reportRows.filter((x) => x.tourId === id)) counts[r.status] += 1;
      return {
        openReportCount: t.openReportCount, flaggedAt: t.flaggedAt ?? null,
        open: openOf(id).sort((a, b) => b.createdAt - a.createdAt), counts,
      };
    },
    async hideIf(id, { adminId, reason }) {
      const t = rows.get(id);
      if (this.raceTo) t.status = this.raceTo;
      if (!t || t.status !== TOUR_STATUS.PUBLIC) return null;
      const open = openOf(id);
      for (const r of open) r.status = 'actioned';
      Object.assign(t, { status: TOUR_STATUS.HIDDEN, openReportCount: 0, flaggedAt: null, updatedAt: nextDate() });
      const data = { fromStatus: 'public', reportCount: open.length };
      await adminActionRepo.append({ adminId, action: 'hide_tour', targetType: 'tour', targetId: id, reason, data });
      return data;
    },
    async restoreIf(id, { adminId, reason }) {
      const t = rows.get(id);
      if (this.raceTo) t.status = this.raceTo;
      if (!t || t.status !== TOUR_STATUS.HIDDEN) return null;
      Object.assign(t, { status: TOUR_STATUS.PUBLIC, updatedAt: nextDate() });
      const data = { fromStatus: 'hidden' };
      await adminActionRepo.append({ adminId, action: 'restore_tour', targetType: 'tour', targetId: id, reason, data });
      return data;
    },
    async dismissIf(id, { adminId, reason }) {
      const t = rows.get(id);
      if (!t || !(t.openReportCount > 0)) return null;
      const open = openOf(id);
      for (const r of open) r.status = 'dismissed';
      Object.assign(t, { openReportCount: 0, flaggedAt: null }); // updatedAt untouched (raw SQL)
      const data = { status: t.status, reportCount: open.length };
      await adminActionRepo.append({ adminId, action: 'dismiss_reports', targetType: 'tour', targetId: id, reason, data });
      return data;
    },
  };

  return { rows, reportRows, log, tourRepo, adminReportRepo, adminActionRepo };
}

function fakePlaceRepo(seed = []) {
  return { async listByTour(tourId) { return seed.filter((p) => p.tourId === tourId); } };
}

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

function tour(id, props = {}) {
  const t = new Tour({ id, title: `Tour ${id.slice(0, 4)}`, description: 'Đi bộ phố cổ', originalLanguage: 'vi',
    authorId: 'u1', type: 'walking', status: TOUR_STATUS.PUBLIC, city: 'Hội An', duration: 90,
    averageRating: 4.5, ratingCount: 2, updatedAt: nextDate(), ...props });
  t.openReportCount = props.openReportCount ?? 0;
  t.flaggedAt = props.flaggedAt ?? null;
  return t;
}
const report = (id, tourId, props = {}) =>
  new TourReport({ id, tourId, reporterId: `r-${id}`, reason: 'spam', note: null, status: 'open', createdAt: nextDate(), ...props });
const place = (id, tourId, sequence, props = {}) =>
  new Place({ id, tourId, name: `Điểm ${id}`, description: 'Mô tả', lat: 15.877, lng: 108.326, sequence,
    images: [], audioUrl: null, updatedAt: nextDate(), ...props });

function setup({ tours = [], reports = [], places = [], publish = fakePublisher(), events = true, chatbot = true } = {}) {
  const store = fakeStore({ tours, reports });
  const logger = fakeLogger();
  const deps = {
    tourRepo: store.tourRepo,
    adminReportRepo: store.adminReportRepo,
    adminActionRepo: store.adminActionRepo,
    adminReportEvents: events ? new EventAdminReportPublisher({ publish, clock }) : null,
    catalog: chatbot ? new EventTourCatalogPublisher({ publish, clock, logger }) : null,
    placeRepo: fakePlaceRepo(places),
    logger,
  };
  return { ...store, deps, publish, logger };
}
const names = (pub) => (pub.events ?? []).map((e) => e.eventName);

// One reported public tour with 3 open reports, flagged.
function reportedSetup(opts = {}) {
  return setup({
    tours: [tour(T1, { openReportCount: 3, flaggedAt: new Date('2026-02-01T00:00:00Z') })],
    reports: [report('r1', T1), report('r2', T1, { reason: 'offensive' }), report('r3', T1), report('old', T1, { status: 'dismissed' })],
    places: [place('p1', T1, 0)],
    ...opts,
  });
}

// ---------- domain ----------

test('compareReportQueue: count desc, flagged first, oldest open report first, then id', () => {
  const a = { tourId: 'a', openReportCount: 2, flaggedAt: null, oldestReportAt: new Date(1) };
  const b = { tourId: 'b', openReportCount: 5, flaggedAt: null, oldestReportAt: new Date(9) };
  const c = { tourId: 'c', openReportCount: 2, flaggedAt: new Date(5), oldestReportAt: new Date(8) };
  const d = { tourId: 'd', openReportCount: 2, flaggedAt: null, oldestReportAt: new Date(0) };
  const e = { tourId: 'e', openReportCount: 2, flaggedAt: null, oldestReportAt: new Date(0) };
  assert.deepEqual([a, b, c, e, d].sort(compareReportQueue).map((x) => x.tourId), ['b', 'c', 'd', 'e', 'a']);
});

test('availableReportActions and reason rules', () => {
  assert.deepEqual(availableReportActions('public', 2), { hide: true, restore: false, dismiss: true });
  assert.deepEqual(availableReportActions('hidden', 0), { hide: false, restore: true, dismiss: false });
  assert.equal(normalizeAdminReason('  x  ', { required: true }), 'x');
  assert.equal(normalizeAdminReason('   '), null);
  assert.equal(normalizeAdminReason(undefined), null);
  assert.throws(() => normalizeAdminReason(' ', { required: true }), (e) => e.status === 422);
  assert.throws(() => normalizeAdminReason('x'.repeat(1001)), (e) => e.status === 422);
});

test('admin action entries: known actions / targets only, frozen once built', () => {
  assert.throws(() => assertAdminActionEntry({ adminId: 'a', action: 'delete_log', targetType: 'tour', targetId: 't' }));
  assert.throws(() => assertAdminActionEntry({ adminId: 'a', action: 'hide_tour', targetType: 'place', targetId: 't' }));
  assert.throws(() => assertAdminActionEntry({ action: 'hide_tour', targetType: 'tour', targetId: 't' }));
  const row = new AdminAction({ adminId: 'a', action: 'hide_tour', targetType: 'tour', targetId: 't' });
  assert.ok(Object.isFrozen(row));
  assert.deepEqual(row.data, {});
});

test('admin action repository exposes append and list methods only (no update, no delete)', () => {
  const calls = [];
  const prisma = { adminAction: new Proxy({}, { get: (_t, k) => (...a) => { calls.push(k); return a; } }) };
  const repo = new PrismaAdminActionRepository(prisma);
  const methods = Object.getOwnPropertyNames(PrismaAdminActionRepository.prototype).filter((m) => m !== 'constructor');
  assert.deepEqual(methods.sort(), ['append', 'appendOnce', 'findById', 'listByTarget', 'listRecent']); // UC22 adds appendOnce / findById
  assert.ok(Object.isFrozen(repo));
  assert.throws(() => { repo.update = () => {}; });
});

test('admin action repository append writes through the given transaction client', async () => {
  const created = [];
  const tx = { adminAction: { async create({ data }) { created.push(data); return { id: 'x', createdAt: new Date(), ...data }; } } };
  const repo = new PrismaAdminActionRepository({ adminAction: { async create() { throw new Error('not in tx'); } } });
  const row = await repo.append({ adminId: 'adm', action: 'dismiss_reports', targetType: 'tour', targetId: T1, data: { reportCount: 2 } }, { tx });
  assert.equal(row.action, 'dismiss_reports');
  assert.deepEqual(created[0], { adminId: 'adm', action: 'dismiss_reports', targetType: 'tour', targetId: T1, reason: null, data: { reportCount: 2 } });
  await assert.rejects(repo.append({ adminId: 'adm', action: 'nope', targetType: 'tour', targetId: T1 }, { tx }));
});

// ---------- queue ----------

test('queue: R1 order, flagged flag, reasons summary, paging; tours without open reports left out', async () => {
  const s = setup({
    tours: [
      tour(T1, { openReportCount: 2 }),
      tour(T2, { openReportCount: 5 }),
      tour(T3, { openReportCount: 2, flaggedAt: new Date('2026-02-01T00:00:00Z') }),
      tour(T4, { openReportCount: 0 }),
      tour(T5, { openReportCount: 2, status: TOUR_STATUS.HIDDEN }),
    ],
    reports: [
      report('a', T5), // oldest open report of the 2-count tours
      report('b', T1, { reason: 'offensive' }), report('c', T1),
      report('d', T2), report('e', T3), report('f', T5),
    ],
  });
  const uc = new ListReportQueue(s.deps);
  const q = await uc.execute({});
  assert.deepEqual(q.tours.map((t) => t.tourId), [T2, T3, T5, T1]);
  assert.equal(q.total, 4);
  assert.equal(q.page, 1);
  assert.equal(q.limit, 20);
  const t3 = q.tours[1];
  assert.equal(t3.flagged, true);
  assert.equal(t3.flaggedAt.toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(q.tours[3].flagged, false);
  assert.deepEqual(q.tours[3].reasons, { offensive: 1, spam: 1 });
  assert.ok(q.tours[3].lastReportAt instanceof Date);
  for (const key of ['tourId', 'title', 'status', 'authorId', 'openReportCount', 'flagged', 'flaggedAt', 'lastReportAt', 'reasons']) {
    assert.ok(key in q.tours[0], key);
  }

  const p2 = await uc.execute({ page: 2, limit: 3 });
  assert.deepEqual(p2.tours.map((t) => t.tourId), [T1]);
  assert.equal(p2.total, 4);
  assert.equal((await uc.execute({ limit: 500 })).limit, 50);
});

test('queue: empty list when no tour has open reports (E1)', async () => {
  const s = setup({ tours: [tour(T1)] });
  const q = await new ListReportQueue(s.deps).execute();
  assert.deepEqual(q.tours, []);
  assert.equal(q.total, 0);
});

// ---------- dossier ----------

test('dossier: tour summary, open reports with reporter id, closed counts, history newest first', async () => {
  const s = reportedSetup();
  s.log.push(new AdminAction({ id: 'old', adminId: 'adm0', action: 'dismiss_reports', targetType: 'tour', targetId: T1, createdAt: nextDate() }));
  s.log.push(new AdminAction({ id: 'other', adminId: 'adm0', action: 'hide_tour', targetType: 'tour', targetId: T2, createdAt: nextDate() }));
  const d = await new GetReportDossier(s.deps).execute({ tourId: T1 });
  assert.deepEqual(Object.keys(d.tour).sort(),
    ['authorId', 'averageRating', 'city', 'description', 'id', 'ratingCount', 'status', 'title']);
  assert.equal(d.tour.averageRating, 4.5);
  assert.equal(d.reports.openReportCount, 3);
  assert.equal(d.reports.flagged, true);
  assert.deepEqual(d.reports.open.map((r) => r.id), ['r3', 'r2', 'r1']);
  assert.equal(d.reports.open[0].reporterId, 'r-r3');
  assert.deepEqual(Object.keys(d.reports.open[0]).sort(), ['createdAt', 'id', 'note', 'reason', 'reporterId']);
  assert.equal(d.reports.dismissedCount, 1);
  assert.equal(d.reports.actionedCount, 0);
  assert.deepEqual(d.actions, { hide: true, restore: false, dismiss: true });
  assert.deepEqual(d.history.map((h) => h.id), ['old']);

  await new HideReportedTour(s.deps).execute({ tourId: T1, adminId: 'adm1', reason: 'Sai sự thật' });
  const d2 = await new GetReportDossier(s.deps).execute({ tourId: T1 });
  assert.deepEqual(d2.history.map((h) => h.action), ['hide_tour', 'dismiss_reports']);
  assert.equal(d2.reports.actionedCount, 3);
  assert.deepEqual(d2.actions, { hide: false, restore: true, dismiss: false });
});

test('dossier: 404 for an unknown tour', async () => {
  const s = reportedSetup();
  await assert.rejects(new GetReportDossier(s.deps).execute({ tourId: MISSING }), (e) => e.status === 404);
});

// ---------- hide ----------

test('hide: public -> hidden, reports actioned, counters reset, one log row, tour.hidden + catalog unpublish', async () => {
  const s = reportedSetup();
  const res = await new HideReportedTour(s.deps).execute({ tourId: T1, adminId: 'adm1', reason: '  Nội dung sai sự thật ' });
  assert.equal(res.tour.status, TOUR_STATUS.HIDDEN);
  assert.equal(res.action, 'hide_tour');
  assert.equal(res.closedReports, 3);
  const t = s.rows.get(T1);
  assert.equal(t.openReportCount, 0);
  assert.equal(t.flaggedAt, null);
  assert.deepEqual(s.reportRows.map((r) => r.status), ['actioned', 'actioned', 'actioned', 'dismissed']);
  assert.equal(s.log.length, 1);
  assert.deepEqual(
    { ...s.log[0].toPublic(), id: undefined, createdAt: undefined },
    { id: undefined, createdAt: undefined, adminId: 'adm1', action: 'hide_tour', targetType: 'tour', targetId: T1,
      reason: 'Nội dung sai sự thật', data: { fromStatus: 'public', reportCount: 3 } },
  );
  assert.deepEqual(names(s.publish), [EVENTS.TOUR_HIDDEN, EVENTS.TOUR_UNPUBLISHED]);
  const hidden = s.publish.events[0].payload;
  assert.deepEqual({ ...hidden, at: undefined, tourTitle: undefined },
    { tourId: T1, reason: 'Nội dung sai sự thật', contributorId: 'u1', at: undefined, tourTitle: undefined });
  assert.equal(hidden.tourTitle, t.title);
  assert.match(hidden.at, /Z$/);
  assert.equal(s.publish.events[1].payload.reason, 'hidden');
  assert.ok(!JSON.stringify(s.publish.events).includes('r-r1')); // never a reporter id
});

test('hide: 409 tour_not_hideable from any other status; reason required (422)', async () => {
  for (const status of [TOUR_STATUS.HIDDEN, TOUR_STATUS.DRAFT, TOUR_STATUS.PENDING_REVIEW, TOUR_STATUS.REJECTED, TOUR_STATUS.RESTRICTED]) {
    const s = setup({ tours: [tour(T1, { status, openReportCount: 1 })], reports: [report('r1', T1)] });
    await assert.rejects(new HideReportedTour(s.deps).execute({ tourId: T1, adminId: 'a', reason: 'x' }),
      (e) => e.status === 409 && e.code === 'tour_not_hideable');
    assert.equal(s.log.length, 0);
    assert.deepEqual(names(s.publish), []);
  }
  const s = reportedSetup();
  await assert.rejects(new HideReportedTour(s.deps).execute({ tourId: T1, adminId: 'a', reason: '  ' }), (e) => e.status === 422);
  await assert.rejects(new HideReportedTour(s.deps).execute({ tourId: MISSING, adminId: 'a', reason: 'x' }), (e) => e.status === 404);
  assert.equal(s.log.length, 0);
});

test('hide race: two admins at once -> one wins, the other gets 409; one log row', async () => {
  const s = reportedSetup();
  const uc = new HideReportedTour(s.deps);
  const results = await Promise.allSettled([
    uc.execute({ tourId: T1, adminId: 'adm1', reason: 'a' }),
    uc.execute({ tourId: T1, adminId: 'adm2', reason: 'b' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = results.find((r) => r.status === 'rejected');
  assert.equal(lost.reason.status, 409);
  assert.equal(lost.reason.code, 'tour_not_hideable');
  assert.equal(s.log.length, 1);
  assert.equal(names(s.publish).filter((n) => n === EVENTS.TOUR_HIDDEN).length, 1);
});

test('hide: write loses the race after the read (status moved) -> 409, nothing sent', async () => {
  const s = reportedSetup();
  s.adminReportRepo.raceTo = TOUR_STATUS.DRAFT; // e.g. the author unpublished meanwhile
  await assert.rejects(new HideReportedTour(s.deps).execute({ tourId: T1, adminId: 'a', reason: 'x' }), (e) => e.status === 409);
  assert.equal(s.log.length, 0);
  assert.deepEqual(names(s.publish), []);
});

test('hide with no broker: still hidden and logged; publish failure is logged only', async () => {
  const s = reportedSetup({ events: false, chatbot: false });
  const res = await new HideReportedTour(s.deps).execute({ tourId: T1, adminId: 'a', reason: 'x' });
  assert.equal(res.tour.status, TOUR_STATUS.HIDDEN);
  assert.equal(s.log.length, 1);
  assert.deepEqual(names(s.publish), []);

  const f = reportedSetup({ publish: failingPublisher });
  const res2 = await new HideReportedTour(f.deps).execute({ tourId: T1, adminId: 'a', reason: 'x' });
  assert.equal(res2.tour.status, TOUR_STATUS.HIDDEN);
  const errors = f.logger.lines.filter(([lvl]) => lvl === 'error').map(([, m]) => m);
  assert.ok(errors.some((m) => m.includes('tour.hidden not sent')));
  assert.ok(errors.some((m) => m.includes('tour.unpublished not sent')));
});

// ---------- restore ----------

test('restore: hidden -> public straight away, log row, tour.restored + catalog tour.published', async () => {
  const s = setup({
    tours: [tour(T1, { status: TOUR_STATUS.HIDDEN })],
    places: [place('p1', T1, 0), place('p2', T1, 1, { moderationStatus: 'rejected' })],
  });
  const res = await new RestoreHiddenTour(s.deps).execute({ tourId: T1, adminId: 'adm1', reason: 'Báo cáo sai (report bomb)' });
  assert.equal(res.tour.status, TOUR_STATUS.PUBLIC);
  assert.equal(res.action, 'restore_tour');
  assert.equal(s.log.length, 1);
  assert.equal(s.log[0].action, 'restore_tour');
  assert.deepEqual(s.log[0].data, { fromStatus: 'hidden' });
  assert.equal(s.log[0].reason, 'Báo cáo sai (report bomb)');
  assert.deepEqual(names(s.publish), [EVENTS.TOUR_RESTORED, EVENTS.TOUR_PUBLISHED]);
  const restored = s.publish.events[0].payload;
  assert.equal(restored.reason, 'Báo cáo sai (report bomb)');
  assert.equal(restored.contributorId, 'u1');
  assert.match(restored.at, /Z$/);
  const published = s.publish.events[1].payload;
  assert.equal(published.status, 'public');
  assert.deepEqual(published.places.map((p) => p.placeId), ['p1']); // rejected place never indexed
});

test('restore without a reason: tour.restored has no reason key and still validates', async () => {
  const s = setup({ tours: [tour(T1, { status: TOUR_STATUS.HIDDEN })], chatbot: false });
  await new RestoreHiddenTour(s.deps).execute({ tourId: T1, adminId: 'adm1' });
  assert.equal(s.log[0].reason, null);
  assert.deepEqual(names(s.publish), [EVENTS.TOUR_RESTORED]);
  assert.equal('reason' in s.publish.events[0].payload, false);
});

test('restore: 409 tour_not_restorable unless hidden; second restore gets 409', async () => {
  for (const status of [TOUR_STATUS.PUBLIC, TOUR_STATUS.DRAFT, TOUR_STATUS.REJECTED]) {
    const s = setup({ tours: [tour(T1, { status })] });
    await assert.rejects(new RestoreHiddenTour(s.deps).execute({ tourId: T1, adminId: 'a' }),
      (e) => e.status === 409 && e.code === 'tour_not_restorable');
    assert.equal(s.log.length, 0);
  }
  const s = setup({ tours: [tour(T1, { status: TOUR_STATUS.HIDDEN })] });
  const uc = new RestoreHiddenTour(s.deps);
  await uc.execute({ tourId: T1, adminId: 'a' });
  await assert.rejects(uc.execute({ tourId: T1, adminId: 'b' }), (e) => e.status === 409);
  assert.equal(s.log.length, 1);
});

// ---------- dismiss ----------

test('dismiss: open reports -> dismissed, counters reset, status and updatedAt unchanged, log row, no event', async () => {
  const s = reportedSetup();
  const before = s.rows.get(T1).updatedAt;
  const res = await new DismissTourReports(s.deps).execute({ tourId: T1, adminId: 'adm1', reason: 'Không vi phạm' });
  assert.deepEqual(res, { tourId: T1, status: 'public', action: 'dismiss_reports', dismissedReports: 3 });
  const t = s.rows.get(T1);
  assert.equal(t.status, TOUR_STATUS.PUBLIC);
  assert.equal(t.openReportCount, 0);
  assert.equal(t.flaggedAt, null);
  assert.equal(t.updatedAt, before);
  assert.deepEqual(s.reportRows.map((r) => r.status), ['dismissed', 'dismissed', 'dismissed', 'dismissed']);
  assert.deepEqual(s.log[0].data, { status: 'public', reportCount: 3 });
  assert.deepEqual(names(s.publish), []);
  // second dismiss: nothing open any more
  await assert.rejects(new DismissTourReports(s.deps).execute({ tourId: T1, adminId: 'adm2' }),
    (e) => e.status === 409 && e.code === 'no_open_reports');
  assert.equal(s.log.length, 1);
  assert.deepEqual((await new ListReportQueue(s.deps).execute()).tours, []);
});

test('dismiss: 409 without open reports, 404 for an unknown tour', async () => {
  const s = setup({ tours: [tour(T1)] });
  await assert.rejects(new DismissTourReports(s.deps).execute({ tourId: T1, adminId: 'a' }), (e) => e.status === 409);
  await assert.rejects(new DismissTourReports(s.deps).execute({ tourId: MISSING, adminId: 'a' }), (e) => e.status === 404);
  assert.equal(s.log.length, 0);
});

test('publisher: tour.hidden reason cut to 1000; tour.restored validates with and without reason', async () => {
  const publish = fakePublisher();
  const pub = new EventAdminReportPublisher({ publish, clock });
  const p = await pub.hidden(tour(T1), 'x'.repeat(1500));
  assert.equal(p.reason.length, 1000);
  const r = await pub.restored(tour(T1), 'y'.repeat(1500));
  assert.equal(r.reason.length, 1000);
  const r2 = await pub.restored(tour(T1, { title: '' }), '');
  assert.equal('reason' in r2, false);
  assert.equal(r2.tourTitle, undefined);
  assert.equal(EVENTS.TOUR_RESTORED, 'tour.restored');
});

// ---------- HTTP router (local server, guard injected) ----------

// Same rules as shared verifyJwt: 401 without a token, 403 for another role. Token = "role:<r>".
const fakeGuard = (roles) => (req, res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const role = h.slice(7).replace('role:', '');
  if (!roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
  req.user = { sub: 'adm1', role };
  next();
};

async function withServer(s, fn) {
  const controller = new AdminReportController({
    listReportQueue: new ListReportQueue(s.deps),
    getReportDossier: new GetReportDossier(s.deps),
    hideReportedTour: new HideReportedTour(s.deps),
    restoreHiddenTour: new RestoreHiddenTour(s.deps),
    dismissTourReports: new DismissTourReports(s.deps),
  });
  const app = express();
  app.use(express.json());
  app.use('/admin/reports', buildAdminReportRouter({ adminReportController: controller, requireAdmin: fakeGuard(['admin']) }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/admin/reports`;
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
  const s = reportedSetup();
  await withServer(s, async (call) => {
    const routes = [['GET', ''], ['GET', `/${T1}`], ['POST', `/${T1}/hide`], ['POST', `/${T1}/restore`], ['POST', `/${T1}/dismiss`]];
    for (const [method, path] of routes) {
      const body = method === 'POST' ? { reason: 'x' } : undefined;
      assert.equal((await call(path, { method, body })).status, 401);
      assert.equal((await call(path, { method, body, token: 'role:contributor' })).status, 403);
      assert.equal((await call(path, { method, body, token: 'role:tourist' })).status, 403);
    }
  });
  assert.equal(s.rows.get(T1).status, TOUR_STATUS.PUBLIC);
  assert.equal(s.log.length, 0);
});

test('router: queue, dossier, 422 / 400 validation, hide / restore / dismiss and their 409s', async () => {
  const s = setup({
    tours: [tour(T1, { openReportCount: 2 }), tour(T2, { openReportCount: 1 })],
    reports: [report('r1', T1), report('r2', T1), report('r3', T2)],
    places: [place('p1', T1, 0)],
  });
  await withServer(s, async (call) => {
    const admin = 'role:admin';
    const q = await call('', { token: admin });
    assert.equal(q.status, 200);
    assert.deepEqual(q.body.tours.map((t) => t.tourId), [T1, T2]);
    assert.equal((await call('?limit=1&page=2', { token: admin })).body.tours[0].tourId, T2);
    for (const qs of ['?limit=0', '?limit=51', '?page=0', '?limit=abc']) {
      assert.equal((await call(qs, { token: admin })).status, 400, qs);
    }

    const d = await call(`/${T1}`, { token: admin });
    assert.equal(d.status, 200);
    assert.equal(d.body.reports.open.length, 2);
    assert.equal(d.body.reports.open[0].reporterId, 'r-r2');
    assert.equal((await call(`/${MISSING}`, { token: admin })).status, 404);
    assert.equal((await call('/not-a-uuid', { token: admin })).status, 400);

    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'x'.repeat(1001) }, { reason: 5 }]) {
      const r = await call(`/${T1}/hide`, { method: 'POST', token: admin, body });
      assert.equal(r.status, 422);
    }
    assert.equal((await call(`/${T1}/dismiss`, { method: 'POST', token: admin, body: { reason: 'x'.repeat(1001) } })).status, 422);
    assert.equal(s.log.length, 0);

    // A2 dismiss T2 (no body), then 409
    const dis = await call(`/${T2}/dismiss`, { method: 'POST', token: admin });
    assert.equal(dis.status, 200);
    assert.equal(dis.body.dismissedReports, 1);
    assert.equal(dis.body.status, 'public');
    assert.equal((await call(`/${T2}/dismiss`, { method: 'POST', token: admin, body: {} })).status, 409);

    // hide T1, then hide again -> 409, restore -> 200, restore again -> 409
    const hide = await call(`/${T1}/hide`, { method: 'POST', token: admin, body: { reason: '  Vi phạm bản quyền ' } });
    assert.equal(hide.status, 200);
    assert.equal(hide.body.tour.status, 'hidden');
    assert.equal(hide.body.closedReports, 2);
    assert.equal(s.log.at(-1).reason, 'Vi phạm bản quyền');
    assert.equal(s.log.at(-1).adminId, 'adm1');
    const again = await call(`/${T1}/hide`, { method: 'POST', token: admin, body: { reason: 'x' } });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'tour_not_hideable');
    const rs = await call(`/${T1}/restore`, { method: 'POST', token: admin, body: { reason: '' } });
    assert.equal(rs.status, 200);
    assert.equal(rs.body.tour.status, 'public');
    assert.equal(s.log.at(-1).reason, null);
    const rs2 = await call(`/${T1}/restore`, { method: 'POST', token: admin });
    assert.equal(rs2.status, 409);
    assert.equal(rs2.body.code, 'tour_not_restorable');
    assert.equal((await call(`/${MISSING}/hide`, { method: 'POST', token: admin, body: { reason: 'x' } })).status, 404);

    assert.deepEqual(s.log.map((a) => a.action), ['dismiss_reports', 'hide_tour', 'restore_tour']);
    assert.deepEqual((await call('', { token: admin })).body.tours, []);
    const hist = await call(`/${T1}`, { token: admin });
    assert.deepEqual(hist.body.history.map((h) => h.action), ['restore_tour', 'hide_tour']);
  });
  assert.deepEqual(names(s.publish), [EVENTS.TOUR_HIDDEN, EVENTS.TOUR_UNPUBLISHED, EVENTS.TOUR_RESTORED, EVENTS.TOUR_PUBLISHED]);
});
