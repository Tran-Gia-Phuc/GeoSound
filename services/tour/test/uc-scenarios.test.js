// =========================================================
// Use-case scenarios: UC15 (submit + AI results) -> UC19 (admin review), UC06 (reports) -> UC20
// (hide / restore). Each test chains the real use cases end to end, so a regression between two
// steps is caught (the single steps are covered by the other test files).
// Fakes only: one in-memory store per scenario, no DB, no broker, no network. Every published
// payload and every AI result goes through the shared zod contract (test/helpers/shared-events.js).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { validateEvent, EVENTS } from './helpers/shared-events.js';
import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { TourReport } from '../src/domain/entities/tour-report.js';
import { TourReviewAction } from '../src/domain/entities/tour-review-action.js';
import { AdminAction, assertAdminActionEntry } from '../src/domain/entities/admin-action.js';
import { CreateTour } from '../src/application/use-cases/create-tour.js';
import { AddPlace } from '../src/application/use-cases/add-place.js';
import { UpdatePlace } from '../src/application/use-cases/update-place.js';
import { UpdateTour } from '../src/application/use-cases/update-tour.js';
import { GetPublishReadiness, PublishTour } from '../src/application/use-cases/publish-tour.js';
import { ApplyModerationResult } from '../src/application/use-cases/apply-moderation-result.js';
import {
  ListReviewQueue, GetReviewDossier, ApproveTour, RejectTour, RequestTourChanges,
} from '../src/application/use-cases/review-tour.js';
import { ReportTour } from '../src/application/use-cases/tour-reports.js';
import { ListReportQueue, HideReportedTour, RestoreHiddenTour } from '../src/application/use-cases/admin-reports.js';
import { EventModerationGateway } from '../src/infrastructure/messaging/event-moderation-gateway.js';
import { EventTourCatalogPublisher } from '../src/infrastructure/messaging/event-tour-catalog-publisher.js';
import { EventTourReviewPublisher } from '../src/infrastructure/messaging/event-tour-review-publisher.js';
import { EventTourReportPublisher } from '../src/infrastructure/messaging/event-tour-report-publisher.js';
import { EventAdminReportPublisher } from '../src/infrastructure/messaging/event-admin-report-publisher.js';
import { buildModerationResultHandler } from '../src/interfaces/events/moderation-result-handler.js';

// --- clock: every write moves updatedAt forward (like Prisma @updatedAt) ---
let tick = Date.parse('2026-03-01T00:00:00.000Z');
const clock = () => new Date((tick += 1000));
const DAY = 24 * 60 * 60 * 1000;
const AUTHOR = 'author-1';

// --- one store behind every repository of a scenario ---
function fakeStore() {
  const tours = new Map();
  const places = new Map();
  const reports = [];
  const reviewLog = [];
  const adminLog = [];
  const patch = (row, fields) => {
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) row[k] = v;
    row.updatedAt = clock();
    return row;
  };
  const openOf = (id) => reports.filter((r) => r.tourId === id && r.status === 'open');

  const tourRepo = {
    rows: tours,
    reviewLog,
    async create(t) { Object.assign(t, { id: crypto.randomUUID(), createdAt: clock(), updatedAt: clock() }); tours.set(t.id, t); return t; },
    async findById(id) { return tours.get(id) ?? null; },
    async findPublicById(id) { const t = tours.get(id); return t?.isPublic() ? t : null; },
    async save(t) { t.updatedAt = clock(); tours.set(t.id, t); return t; },
    async updateModeration(id, fields) { return patch(tours.get(id), fields); },
    async applyModerationResultIf(id, revision, fields) {
      const t = tours.get(id);
      if (!t || t.status !== TOUR_STATUS.AI_CHECKING || t.moderationRevision !== revision) return 0;
      Object.assign(t, fields, { updatedAt: clock() });
      return 1;
    },
    async listByStatuses(statuses) {
      return [...tours.values()].filter((t) => statuses.includes(t.status)).sort((a, b) => a.updatedAt - b.updatedAt);
    },
    // UPDATE ... WHERE status IN (reviewable) + review log row in the same transaction.
    async applyReviewDecisionIf(id, fromStatuses, { status, reviewReason }, entry) {
      const t = tours.get(id);
      if (!t || !fromStatuses.includes(t.status)) return 0;
      Object.assign(t, { status, reviewReason, updatedAt: clock() });
      reviewLog.push(new TourReviewAction({ id: `r${reviewLog.length + 1}`, tourId: id, ...entry, createdAt: clock() }));
      return 1;
    },
  };

  const placeRepo = {
    rows: places,
    async create(p) { p.id = crypto.randomUUID(); p.updatedAt = clock(); places.set(p.id, p); return p; },
    async findById(id) { return places.get(id) ?? null; },
    async listByTour(tourId) { return [...places.values()].filter((p) => p.tourId === tourId).sort((a, b) => a.sequence - b.sequence); },
    async save(p) { p.updatedAt = clock(); places.set(p.id, p); return p; },
    async nextSequence(tourId) { return (await this.listByTour(tourId)).length; },
    async updateModeration(id, fields) { return patch(places.get(id), fields); },
    async applyModerationResultIf(id, revision, fields) {
      const p = places.get(id);
      if (!p || p.moderationRevision !== revision) return 0;
      Object.assign(p, fields, { updatedAt: clock() });
      return 1;
    },
  };

  const reviewActionRepo = { async listByTour(id) { return reviewLog.filter((a) => a.tourId === id).reverse(); } };

  // Same rule as PrismaTourReportRepository: one report per (tour, account); distinct open reporters
  // since windowStart decide the flag, set once. Counters live on the tour row.
  const reportRepo = {
    rows: reports,
    async findByTourAndReporter(tourId, reporterId) { return reports.find((r) => r.tourId === tourId && r.reporterId === reporterId) ?? null; },
    async createReport({ tourId, reporterId, reason, note }, { windowStart, threshold }) {
      if (await this.findByTourAndReporter(tourId, reporterId)) return null;
      const report = new TourReport({ id: crypto.randomUUID(), tourId, reporterId, reason, note, createdAt: clock() });
      reports.push(report);
      const recent = new Set(openOf(tourId).filter((r) => r.createdAt >= windowStart).map((r) => r.reporterId)).size;
      const t = tours.get(tourId);
      t.openReportCount = (t.openReportCount ?? 0) + 1;
      if (!t.flaggedAt && recent >= threshold) t.flaggedAt = clock();
      return { report, openReportCount: t.openReportCount, recentReporters: recent, flagged: Boolean(t.flaggedAt) };
    },
  };

  const adminActionRepo = {
    log: adminLog,
    async append(entry) {
      assertAdminActionEntry(entry);
      const row = new AdminAction({ id: `a${adminLog.length + 1}`, ...entry, createdAt: clock() });
      adminLog.push(row);
      return row;
    },
    async listByTarget(type, id) { return adminLog.filter((a) => a.targetType === type && a.targetId === id).reverse(); },
  };

  const adminReportRepo = {
    async listQueue({ skip, take }) {
      const items = [...tours.values()].filter((t) => t.openReportCount > 0).map((t) => ({
        tourId: t.id, title: t.title, status: t.status, authorId: t.authorId,
        openReportCount: t.openReportCount, flaggedAt: t.flaggedAt ?? null, reasons: {},
      }));
      return { items: items.slice(skip, skip + take), total: items.length };
    },
    async hideIf(id, { adminId, reason }) {
      const t = tours.get(id);
      if (!t || t.status !== TOUR_STATUS.PUBLIC) return null;
      const open = openOf(id);
      for (const r of open) r.status = 'actioned';
      Object.assign(t, { status: TOUR_STATUS.HIDDEN, openReportCount: 0, flaggedAt: null, updatedAt: clock() });
      const data = { fromStatus: 'public', reportCount: open.length };
      await adminActionRepo.append({ adminId, action: 'hide_tour', targetType: 'tour', targetId: id, reason, data });
      return data;
    },
    async restoreIf(id, { adminId, reason }) {
      const t = tours.get(id);
      if (!t || t.status !== TOUR_STATUS.HIDDEN) return null;
      Object.assign(t, { status: TOUR_STATUS.PUBLIC, updatedAt: clock() });
      const data = { fromStatus: 'hidden' };
      await adminActionRepo.append({ adminId, action: 'restore_tour', targetType: 'tour', targetId: id, reason, data });
      return data;
    },
  };

  return { tourRepo, placeRepo, reviewActionRepo, reportRepo, adminActionRepo, adminReportRepo, reviewLog };
}

// Validates every event with the shared contract, like shared/rabbitmq publish().
function fakePublisher() {
  const events = [];
  const pub = async (eventName, payload) => { events.push({ eventName, payload: validateEvent(eventName, payload) }); };
  pub.events = events;
  return pub;
}

function fakeLogger() {
  const lines = [];
  return { lines, info: (m) => lines.push(['info', m]), warn: (m) => lines.push(['warn', m]), error: (m) => lines.push(['error', m]) };
}

// Wiring of container.js with both flags on (MODERATION_EVENTS_ENABLED, CHATBOT_EVENTS_ENABLED).
function world() {
  const store = fakeStore();
  const publish = fakePublisher();
  const logger = fakeLogger();
  const deps = {
    ...store,
    zoneChecker: { async assertAllowed() {} },
    moderation: new EventModerationGateway({ publish, clock }),
    catalog: new EventTourCatalogPublisher({ publish, clock, logger }),
    reviewEvents: new EventTourReviewPublisher({ publish, clock }),
    reportEvents: new EventTourReportPublisher({ publish, clock }),
    adminReportEvents: new EventAdminReportPublisher({ publish, clock }),
    clock,
    logger,
  };
  const uc = {
    createTour: new CreateTour(deps),
    addPlace: new AddPlace(deps),
    updatePlace: new UpdatePlace(deps),
    updateTour: new UpdateTour(deps),
    readiness: new GetPublishReadiness(deps),
    submit: new PublishTour(deps),
    queue: new ListReviewQueue(deps),
    dossier: new GetReviewDossier(deps),
    approve: new ApproveTour(deps),
    reject: new RejectTour(deps),
    requestChanges: new RequestTourChanges(deps),
    report: new ReportTour(deps),
    reportQueue: new ListReportQueue(deps),
    hide: new HideReportedTour(deps),
    restore: new RestoreHiddenTour(deps),
  };
  // Moderation results arrive through the real RabbitMQ handler (contract check, never throws).
  const handler = buildModerationResultHandler({ applyModerationResult: new ApplyModerationResult(deps), validateEvent, logger });
  const deliver = async (eventName, payload) => {
    await handler(eventName, payload);
    const errors = logger.lines.filter(([lvl]) => lvl === 'error');
    assert.deepEqual(errors, [], `${eventName} must be applied without error`);
  };
  const names = () => publish.events.map((e) => e.eventName);
  const last = (eventName) => publish.events.filter((e) => e.eventName === eventName).at(-1)?.payload;
  const tourOf = (id) => store.tourRepo.rows.get(id);
  return { ...store, publish, logger, uc, deliver, names, last, tourOf };
}

const reason = (message, props = {}) => ({ field: 'description', category: 'misleading', message, source: 'ai', severity: 0.5, ...props });

/** UC09/UC10: a draft tour with two places, each sent to AI moderation (place.submitted). */
async function draftWithPlaces(w) {
  const tour = await w.uc.createTour.execute({ authorId: AUTHOR, title: ' Phố cổ Hội An ', description: 'Đi bộ phố cổ',
    originalLanguage: 'vi', city: 'Hội An', duration: 90 });
  const add = (name) => w.uc.addPlace.execute({ authorId: AUTHOR, tourId: tour.id, name, description: `Thuyết minh ${name}`,
    lat: 15.877, lng: 108.326 });
  const p1 = await add('Chùa Cầu');
  const p2 = await add('Hội quán Phúc Kiến');
  return { tourId: tour.id, p1: p1.id, p2: p2.id };
}

/** Answers the last place.submitted of a place (revision echoed back, like Moderation). */
async function placeResult(w, placeId, eventName = EVENTS.PLACE_AI_PASSED, extra = {}) {
  const sent = w.publish.events.filter((e) => e.eventName === EVENTS.PLACE_SUBMITTED && e.payload.placeId === placeId).at(-1).payload;
  await w.deliver(eventName, { placeId, tourId: sent.tourId, revision: sent.revision, ...extra });
}

/** UC15: submit, return the revision carried by tour.submitted. */
async function submit(w, tourId) {
  const res = await w.uc.submit.execute({ authorId: AUTHOR, tourId });
  assert.equal(res.tour.status, TOUR_STATUS.AI_CHECKING);
  return w.last(EVENTS.TOUR_SUBMITTED).revision;
}

/** UC15 + UC19: a tour that went through AI moderation and admin approval (public). */
async function approvedTour(w) {
  const ids = await draftWithPlaces(w);
  await placeResult(w, ids.p1);
  await placeResult(w, ids.p2);
  const revision = await submit(w, ids.tourId);
  await w.deliver(EVENTS.TOUR_AI_PASSED, { tourId: ids.tourId, revision });
  await w.uc.approve.execute({ tourId: ids.tourId, adminId: 'adm1' });
  assert.equal(w.tourOf(ids.tourId).status, TOUR_STATUS.PUBLIC);
  return ids;
}

const isConflict = (code) => (e) => e.status === 409 && (!code || e.code === code);

// =========================================================
// 1. UC15 -> UC19 happy path
// =========================================================

test('UC15 -> UC19: draft, places pass AI, submit, AI warning, first in queue, approve -> public', async () => {
  const w = world();
  const { tourId, p1, p2 } = await draftWithPlaces(w);
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.DRAFT);
  assert.deepEqual([p1, p2].map((id) => w.placeRepo.rows.get(id).moderationStatus), ['checking', 'checking']);
  assert.deepEqual(w.names(), [EVENTS.PLACE_SUBMITTED, EVENTS.PLACE_SUBMITTED]);
  assert.equal((await w.uc.readiness.execute({ authorId: AUTHOR, tourId })).ready, false);

  await placeResult(w, p1);
  await placeResult(w, p2, EVENTS.PLACE_AI_PASSED, { warning: true, severity: 0.5, reasons: [reason('Hơi quảng cáo')] });
  assert.equal(w.placeRepo.rows.get(p1).moderationStatus, 'approved');
  assert.equal(w.placeRepo.rows.get(p2).moderationStatus, 'warning');
  assert.equal((await w.uc.readiness.execute({ authorId: AUTHOR, tourId })).ready, true);

  const revision = await submit(w, tourId);
  const submitted = w.last(EVENTS.TOUR_SUBMITTED);
  assert.equal(submitted.contributorId, AUTHOR);
  assert.equal(submitted.title, 'Phố cổ Hội An');
  assert.deepEqual(submitted.places.map((p) => [p.placeId, p.sequence]), [[p1, 0], [p2, 1]]);
  assert.match(revision, /Z$/);
  assert.equal(w.tourOf(tourId).moderationRevision, revision);

  const geo = reason('Chặng 2 quá dài cho tour đi bộ', { field: 'coherence', category: 'route', source: 'geo' });
  await w.deliver(EVENTS.TOUR_AI_PASSED, { tourId, revision, warning: true, severity: 0.5, reasons: [geo] });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.AI_WARNING);
  assert.deepEqual(w.tourOf(tourId).moderationReasons, [geo]);

  // An older tour waiting without warning comes after ours (ai_warning first).
  const other = await w.tourRepo.create(new Tour({ title: 'Khác', originalLanguage: 'vi', authorId: 'u2', status: TOUR_STATUS.PENDING_REVIEW }));
  other.updatedAt = new Date('2026-01-01T00:00:00.000Z');
  const queue = await w.uc.queue.execute();
  assert.deepEqual(queue.map((q) => [q.id, q.aiWarning]), [[tourId, true], [other.id, false]]);
  const dossier = await w.uc.dossier.execute({ tourId });
  assert.equal(dossier.reviewable, true);
  assert.deepEqual(dossier.places.map((p) => p.moderationStatus), ['approved', 'warning']);

  const res = await w.uc.approve.execute({ tourId, adminId: 'adm1' });
  assert.equal(res.tour.status, TOUR_STATUS.PUBLIC);
  assert.deepEqual(w.names(), [EVENTS.PLACE_SUBMITTED, EVENTS.PLACE_SUBMITTED, EVENTS.TOUR_SUBMITTED,
    EVENTS.TOUR_APPROVED, EVENTS.TOUR_PUBLISHED]);
  assert.equal(w.last(EVENTS.TOUR_APPROVED).adminId, 'adm1');
  assert.deepEqual(w.last(EVENTS.TOUR_PUBLISHED).places.map((p) => p.placeId), [p1, p2]); // warning place indexed
  assert.deepEqual(w.reviewLog.map((a) => [a.action, a.fromStatus]), [['approve', 'ai_warning']]);
  assert.deepEqual((await w.uc.queue.execute()).map((q) => q.id), [other.id]);
});

// =========================================================
// 2. UC15 submit blocked by place moderation
// =========================================================

test('UC15: submit refused while a place is checking or rejected; a warning place does not block', async () => {
  const w = world();
  const { tourId, p1, p2 } = await draftWithPlaces(w);
  const refused = (label) => (e) => e.status === 422 && e.missing.some((m) => m.key === 'placesModeration' && m.label.includes(label));

  await assert.rejects(w.uc.submit.execute({ authorId: AUTHOR, tourId }), refused('Chùa Cầu')); // both checking

  await placeResult(w, p1, EVENTS.PLACE_AI_REJECTED, { reason: 'Quảng cáo trá hình' });
  await placeResult(w, p2, EVENTS.PLACE_AI_PASSED, { warning: true, reasons: [reason('Hơi quảng cáo')] });
  assert.equal(w.placeRepo.rows.get(p1).moderationStatus, 'rejected');
  assert.equal(w.placeRepo.rows.get(p1).moderationReasons[0].message, 'Quảng cáo trá hình');
  await assert.rejects(w.uc.submit.execute({ authorId: AUTHOR, tourId }), refused('bị AI từ chối'));
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.DRAFT);
  assert.equal(w.names().includes(EVENTS.TOUR_SUBMITTED), false);

  // The author fixes the rejected place: checking again, a new place.submitted with a new revision.
  const oldRevision = w.placeRepo.rows.get(p1).moderationRevision;
  await w.uc.updatePlace.execute({ authorId: AUTHOR, tourId, placeId: p1, patch: { description: 'Lịch sử Chùa Cầu' } });
  assert.equal(w.placeRepo.rows.get(p1).moderationStatus, 'checking');
  assert.notEqual(w.placeRepo.rows.get(p1).moderationRevision, oldRevision);
  await w.deliver(EVENTS.PLACE_AI_REJECTED, { placeId: p1, tourId, revision: oldRevision, reason: 'cũ' }); // stale
  assert.equal(w.placeRepo.rows.get(p1).moderationStatus, 'checking');

  await placeResult(w, p1);
  await submit(w, tourId); // p1 approved, p2 warning: allowed
  assert.equal(w.last(EVENTS.TOUR_SUBMITTED).places.length, 2);
});

// =========================================================
// 3. UC15 stale results and withdraw on edit
// =========================================================

test('UC15: editing during ai_checking sends the tour back to draft; the late AI result is ignored', async () => {
  const w = world();
  const { tourId, p1, p2 } = await draftWithPlaces(w);
  await placeResult(w, p1);
  await placeResult(w, p2);
  const revision = await submit(w, tourId);

  const edit = await w.uc.updateTour.execute({ authorId: AUTHOR, tourId, patch: { description: 'Mô tả mới' } });
  assert.equal(edit.tour.status, TOUR_STATUS.DRAFT);
  assert.equal(edit.requiresResubmit, true);
  assert.equal(w.tourOf(tourId).moderationRevision, null);

  await w.deliver(EVENTS.TOUR_AI_PASSED, { tourId, revision });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.DRAFT);
  assert.deepEqual(await w.uc.queue.execute(), []);
  await assert.rejects(w.uc.approve.execute({ tourId, adminId: 'adm1' }), isConflict('tour_not_reviewable'));
});

test('UC15: after a resubmit, a result with the old revision is ignored and the new one applies', async () => {
  const w = world();
  const { tourId, p1, p2 } = await draftWithPlaces(w);
  await placeResult(w, p1);
  await placeResult(w, p2);
  const first = await submit(w, tourId);
  await w.uc.updateTour.execute({ authorId: AUTHOR, tourId, patch: { title: 'Hội An về đêm' } });
  const second = await submit(w, tourId);
  assert.notEqual(second, first);
  assert.equal(w.last(EVENTS.TOUR_SUBMITTED).title, 'Hội An về đêm');

  await w.deliver(EVENTS.TOUR_AI_REJECTED, { tourId, revision: first, reason: 'Nội dung cũ' });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.AI_CHECKING);
  await w.deliver(EVENTS.TOUR_AI_PASSED, { tourId, revision: second });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.PENDING_REVIEW);
  await w.deliver(EVENTS.TOUR_AI_REJECTED, { tourId, revision: second, reason: 'trùng' }); // duplicate after apply
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.PENDING_REVIEW);
});

test('UC15: AI rejects -> draft with reasons for the author; fixed and resubmitted -> pending_review', async () => {
  const w = world();
  const { tourId, p1, p2 } = await draftWithPlaces(w);
  await placeResult(w, p1);
  await placeResult(w, p2);
  const first = await submit(w, tourId);
  const hate = reason('Nội dung thù ghét', { field: 'title', category: 'hate', severity: 0.9 });
  await w.deliver(EVENTS.TOUR_AI_REJECTED, { tourId, revision: first, reason: hate.message, reasons: [hate] });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.DRAFT);
  assert.deepEqual(w.tourOf(tourId).toPublic().moderationReasons, [hate]);
  assert.deepEqual(await w.uc.queue.execute(), []);

  await w.uc.updateTour.execute({ authorId: AUTHOR, tourId, patch: { title: 'Phố cổ thân thiện' } });
  const second = await submit(w, tourId);
  assert.deepEqual(w.tourOf(tourId).moderationReasons, []); // cleared on submit
  await w.deliver(EVENTS.TOUR_AI_PASSED, { tourId, revision: second });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.PENDING_REVIEW);
  assert.deepEqual((await w.uc.queue.execute()).map((q) => q.id), [tourId]);
});

// =========================================================
// 4. UC19 request changes -> resubmit -> reject
// =========================================================

test('UC19: request changes -> author resubmits -> second AI round -> admin rejects; 409s; every decision logged', async () => {
  const w = world();
  const { tourId, p1, p2 } = await draftWithPlaces(w);
  await placeResult(w, p1);
  await placeResult(w, p2);
  await w.deliver(EVENTS.TOUR_AI_PASSED, { tourId, revision: await submit(w, tourId) });

  const rc = await w.uc.requestChanges.execute({ tourId, adminId: 'adm1', reason: 'Thêm ảnh cho Chùa Cầu' });
  assert.equal(rc.tour.status, TOUR_STATUS.CHANGES_REQUESTED);
  assert.equal(rc.tour.reviewReason, 'Thêm ảnh cho Chùa Cầu');
  assert.equal(w.last(EVENTS.TOUR_CHANGES_REQUESTED).reason, 'Thêm ảnh cho Chùa Cầu');
  assert.deepEqual(await w.uc.queue.execute(), []);
  await assert.rejects(w.uc.approve.execute({ tourId, adminId: 'adm2' }), isConflict('tour_not_reviewable'));

  // The author edits and submits again (UC15): a second moderation round with a new revision.
  await w.uc.updateTour.execute({ authorId: AUTHOR, tourId, patch: { description: 'Thêm ảnh và thuyết minh' } });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.CHANGES_REQUESTED); // not in moderation: no withdraw
  const second = await submit(w, tourId);
  await assert.rejects(w.uc.reject.execute({ tourId, adminId: 'adm1', reason: 'x' }), isConflict('tour_not_reviewable')); // ai_checking
  await w.deliver(EVENTS.TOUR_AI_PASSED, { tourId, revision: second });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.PENDING_REVIEW);

  const rj = await w.uc.reject.execute({ tourId, adminId: 'adm2', reason: 'Nội dung trùng tour khác' });
  assert.equal(rj.tour.status, TOUR_STATUS.REJECTED);
  assert.equal(rj.tour.reviewReason, 'Nội dung trùng tour khác');
  const rejected = w.last(EVENTS.TOUR_REJECTED);
  assert.equal(rejected.reason, 'Nội dung trùng tour khác');
  assert.equal(rejected.contributorId, AUTHOR);
  await assert.rejects(w.uc.approve.execute({ tourId, adminId: 'adm1' }), isConflict('tour_not_reviewable'));

  assert.deepEqual(w.reviewLog.map((a) => [a.action, a.adminId, a.fromStatus, a.reason]), [
    ['request_changes', 'adm1', 'pending_review', 'Thêm ảnh cho Chùa Cầu'],
    ['reject', 'adm2', 'pending_review', 'Nội dung trùng tour khác'],
  ]);
  const { history } = await w.uc.dossier.execute({ tourId });
  assert.deepEqual(history.map((h) => h.action), ['reject', 'request_changes']); // newest first
  assert.equal(w.names().filter((n) => n === EVENTS.TOUR_SUBMITTED).length, 2);
  assert.equal(w.names().includes(EVENTS.TOUR_PUBLISHED), false); // never public
});

// =========================================================
// 5. UC06 reports -> UC20 hide / restore
// =========================================================

test('UC06: 5 distinct accounts within 7 days flag the tour into the report queue; it stays public', async () => {
  const w = world();
  const { tourId } = await approvedTour(w);
  // An open report from 8 days ago: counted as open, but outside the 7-day window.
  w.reportRepo.rows.push(new TourReport({ id: crypto.randomUUID(), tourId, reporterId: 'old', reason: 'spam',
    createdAt: new Date(tick - 8 * DAY) }));
  w.tourOf(tourId).openReportCount = 1;

  for (const u of ['u1', 'u2', 'u3', 'u4']) {
    assert.equal((await w.uc.report.execute({ tourId, reporterId: u, reason: 'false_info' })).flagged, false);
  }
  await assert.rejects(w.uc.report.execute({ tourId, reporterId: 'u1', reason: 'spam' }), isConflict('already_reported'));
  await assert.rejects(w.uc.report.execute({ tourId, reporterId: AUTHOR, reason: 'spam' }), (e) => e.status === 403);
  assert.equal(w.tourOf(tourId).flaggedAt ?? null, null); // duplicate and own report do not count

  const queued = (await w.uc.reportQueue.execute()).tours;
  assert.deepEqual(queued.map((t) => [t.tourId, t.flagged]), [[tourId, false]]);

  const fifth = await w.uc.report.execute({ tourId, reporterId: 'u5', reason: 'offensive' });
  assert.equal(fifth.flagged, true);
  const reported = w.publish.events.filter((e) => e.eventName === EVENTS.TOUR_REPORTED).map((e) => [e.payload.count, e.payload.flagged]);
  assert.deepEqual(reported, [[2, false], [3, false], [4, false], [5, false], [6, true]]);
  assert.ok(!JSON.stringify(w.publish.events).includes('"u5"')); // reporter ids never leave Tour

  const [item] = (await w.uc.reportQueue.execute()).tours;
  assert.deepEqual([item.tourId, item.flagged, item.openReportCount, item.status], [tourId, true, 6, TOUR_STATUS.PUBLIC]);
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.PUBLIC);
});

test('UC20: admin hides a reported tour (not public, unpublished) then restores it (public again)', async () => {
  const w = world();
  const { tourId, p1, p2 } = await approvedTour(w);
  for (const u of ['u1', 'u2', 'u3', 'u4', 'u5']) await w.uc.report.execute({ tourId, reporterId: u, reason: 'spam' });
  const before = w.names().length;

  const hidden = await w.uc.hide.execute({ tourId, adminId: 'adm1', reason: 'Nội dung sai sự thật' });
  assert.equal(hidden.tour.status, TOUR_STATUS.HIDDEN);
  assert.equal(hidden.closedReports, 5);
  assert.equal(w.tourOf(tourId).isPublic(), false);
  assert.deepEqual(w.names().slice(before), [EVENTS.TOUR_HIDDEN, EVENTS.TOUR_UNPUBLISHED]);
  assert.equal(w.last(EVENTS.TOUR_HIDDEN).reason, 'Nội dung sai sự thật');
  assert.equal(w.last(EVENTS.TOUR_UNPUBLISHED).reason, 'hidden');
  assert.deepEqual((await w.uc.reportQueue.execute()).tours, []);
  assert.deepEqual(w.reportRepo.rows.map((r) => r.status), ['actioned', 'actioned', 'actioned', 'actioned', 'actioned']);
  // Hidden: visitors cannot report it, the author cannot republish it, a second hide is a conflict.
  await assert.rejects(w.uc.report.execute({ tourId, reporterId: 'u6', reason: 'spam' }), (e) => e.status === 404);
  await assert.rejects(w.uc.submit.execute({ authorId: AUTHOR, tourId }), (e) => e.status >= 400);
  await assert.rejects(w.uc.hide.execute({ tourId, adminId: 'adm2', reason: 'x' }), isConflict('tour_not_hideable'));

  const restored = await w.uc.restore.execute({ tourId, adminId: 'adm2', reason: 'Báo cáo sai' });
  assert.equal(restored.tour.status, TOUR_STATUS.PUBLIC);
  assert.deepEqual(w.names().slice(before + 2), [EVENTS.TOUR_RESTORED, EVENTS.TOUR_PUBLISHED]);
  assert.deepEqual(w.last(EVENTS.TOUR_PUBLISHED).places.map((p) => p.placeId), [p1, p2]);
  await assert.rejects(w.uc.restore.execute({ tourId, adminId: 'adm1' }), isConflict('tour_not_restorable'));
  assert.equal((await w.uc.report.execute({ tourId, reporterId: 'u6', reason: 'spam' })).flagged, false); // reportable again

  assert.deepEqual(w.adminActionRepo.log.map((a) => [a.action, a.adminId, a.data]), [
    ['hide_tour', 'adm1', { fromStatus: 'public', reportCount: 5 }],
    ['restore_tour', 'adm2', { fromStatus: 'hidden' }],
  ]);
});
