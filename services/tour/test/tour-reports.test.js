// =========================================================
// UC06 (#268) — tour reports: domain rules, use cases with in-memory fakes (same threshold rule as
// the SQL in PrismaTourReportRepository), the tour.reported payload checked against the shared zod
// contract, and the HTTP routes with a stand-in for verifyJwt().
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import {
  TourReport,
  normalizeReportInput,
  reportWindowStart,
  reachesFlagThreshold,
  REPORT_REASONS,
  REPORT_STATUS,
  REPORT_NOTE_MAX,
  REPORT_FLAG_THRESHOLD,
} from '../src/domain/entities/tour-report.js';
import { ReportTour, GetMyTourReport } from '../src/application/use-cases/tour-reports.js';
import { EventTourReportPublisher, TOUR_REPORTED } from '../src/infrastructure/messaging/event-tour-report-publisher.js';
import { TourReportController } from '../src/interfaces/http/controllers/tour-report-controller.js';
import { buildTourReportRouter } from '../src/interfaces/http/routes/tour-report-routes.js';
import { validateEvent, EVENTS } from './helpers/shared-events.js';

const PUBLIC_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-11-03T08:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function makeTour(id, { status = TOUR_STATUS.PUBLIC, authorId = 'author' } = {}) {
  return new Tour({ id, title: `Tour ${id.slice(0, 4)}`, originalLanguage: 'vi', authorId, status });
}

class FakeTourRepo {
  constructor(tours) {
    this.rows = new Map(tours.map((t) => [t.id, t]));
    // Columns written by the report repository only (not on the Tour entity).
    this.flags = new Map(tours.map((t) => [t.id, { openReportCount: 0, reportFlaggedAt: null }]));
  }
  async findPublicById(id) {
    const t = this.rows.get(id);
    return t && t.status === TOUR_STATUS.PUBLIC ? t : null;
  }
}

// Same semantics as PrismaTourReportRepository: unique (tour, reporter), distinct open reporters
// since windowStart (new row included), flag set once. Single-threaded, like the tour row lock.
class FakeReportRepo {
  constructor(tourRepo, clock) {
    this.tourRepo = tourRepo;
    this.clock = clock;
    this.rows = [];
  }
  seed({ tourId, reporterId, reason = 'spam', status = REPORT_STATUS.OPEN, createdAt }) {
    this.rows.push(new TourReport({ id: crypto.randomUUID(), tourId, reporterId, reason, status, createdAt }));
  }
  async findByTourAndReporter(tourId, reporterId) {
    return this.rows.find((r) => r.tourId === tourId && r.reporterId === reporterId) ?? null;
  }
  async createReport({ tourId, reporterId, reason, note }, { windowStart, threshold }) {
    if (await this.findByTourAndReporter(tourId, reporterId)) return null;
    const row = new TourReport({ id: crypto.randomUUID(), tourId, reporterId, reason, note, createdAt: this.clock() });
    this.rows.push(row);
    const recent = new Set(
      this.rows
        .filter((r) => r.tourId === tourId && r.status === REPORT_STATUS.OPEN && r.createdAt >= windowStart)
        .map((r) => r.reporterId),
    ).size;
    const f = this.tourRepo.flags.get(tourId);
    const before = f.reportFlaggedAt;
    f.openReportCount += 1;
    if (!f.reportFlaggedAt && recent >= threshold) f.reportFlaggedAt = this.clock();
    return {
      report: row,
      openReportCount: f.openReportCount,
      recentReporters: recent,
      flagged: f.reportFlaggedAt !== null,
      flaggedNow: before === null && f.reportFlaggedAt !== null,
    };
  }
}

function kit({ publish } = {}) {
  let now = NOW;
  const clock = () => new Date(now);
  const tourRepo = new FakeTourRepo([makeTour(PUBLIC_ID), makeTour(DRAFT_ID, { status: TOUR_STATUS.DRAFT })]);
  const reportRepo = new FakeReportRepo(tourRepo, clock);
  const sent = [];
  const warnings = [];
  const reportEvents = new EventTourReportPublisher({
    publish:
      publish ??
      (async (event, payload) => {
        validateEvent(event, payload); // same check as shared/rabbitmq publish
        sent.push({ event, payload });
      }),
    clock,
  });
  const logger = { warn: (m) => warnings.push(m) };
  return {
    tourRepo,
    reportRepo,
    sent,
    warnings,
    advance: (ms) => (now += ms),
    report: new ReportTour({ tourRepo, reportRepo, reportEvents, clock, logger }),
    mine: new GetMyTourReport({ tourRepo, reportRepo }),
  };
}

// ---------- domain ----------
test('input rules: reason required (E2) and from the list, note trimmed, max 500, required for other', () => {
  assert.throws(() => normalizeReportInput({}), { code: 'validation_error', message: 'Vui lòng chọn lý do báo cáo' });
  assert.throws(() => normalizeReportInput({ reason: '' }), { message: 'Vui lòng chọn lý do báo cáo' });
  assert.throws(() => normalizeReportInput({ reason: 'boring' }), { code: 'validation_error' });
  assert.throws(() => normalizeReportInput({ reason: 'other' }), { message: 'Vui lòng mô tả lý do' });
  assert.throws(() => normalizeReportInput({ reason: 'other', note: '   ' }), { message: 'Vui lòng mô tả lý do' });
  assert.deepEqual(normalizeReportInput({ reason: 'other', note: '  Quảng cáo trá hình ' }), { reason: 'other', note: 'Quảng cáo trá hình' });
  assert.deepEqual(normalizeReportInput({ reason: 'spam', note: '  ' }), { reason: 'spam', note: null });
  assert.deepEqual(normalizeReportInput({ reason: 'copyright' }), { reason: 'copyright', note: null });
  assert.equal(normalizeReportInput({ reason: 'spam', note: 'x'.repeat(REPORT_NOTE_MAX) }).note.length, REPORT_NOTE_MAX);
  assert.throws(() => normalizeReportInput({ reason: 'spam', note: 'x'.repeat(REPORT_NOTE_MAX + 1) }), { code: 'validation_error' });
  assert.deepEqual([...REPORT_REASONS], ['false_info', 'offensive', 'spam', 'copyright', 'other']);
});

test('threshold and window: 5 distinct accounts in 7 days', () => {
  assert.equal(REPORT_FLAG_THRESHOLD, 5);
  assert.equal(reachesFlagThreshold(4), false);
  assert.equal(reachesFlagThreshold(5), true);
  assert.equal(reportWindowStart(new Date(NOW)).getTime(), NOW - 7 * DAY);
});

test('views never carry the reporter id', () => {
  const r = new TourReport({ id: 'r1', tourId: PUBLIC_ID, reporterId: 'secret', reason: 'spam', createdAt: new Date(NOW) });
  assert.equal(r.status, 'open');
  assert.deepEqual(Object.keys(r.toCreated()).sort(), ['createdAt', 'id', 'note', 'reason']);
  assert.deepEqual(Object.keys(r.toMine()).sort(), ['createdAt', 'note', 'reason']);
});

// ---------- use cases ----------
test('report: saved, open count raised, event published with the shared contract and no reporter id', async () => {
  const k = kit();
  const r = await k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u1', reason: 'false_info', note: ' Sai giờ mở cửa ' });
  assert.equal(r.flagged, false);
  assert.equal(r.report.reason, 'false_info');
  assert.equal(r.report.note, 'Sai giờ mở cửa');
  assert.equal(r.report.reporterId, undefined);
  assert.equal(k.tourRepo.flags.get(PUBLIC_ID).openReportCount, 1);

  assert.equal(k.sent.length, 1);
  const { event, payload } = k.sent[0];
  assert.equal(event, TOUR_REPORTED);
  assert.equal(event, EVENTS.TOUR_REPORTED);
  assert.deepEqual(payload, {
    tourId: PUBLIC_ID,
    count: 1,
    reason: 'false_info',
    flagged: false,
    contributorId: 'author',
    tourTitle: 'Tour 1111',
    at: '2026-11-03T08:00:00.000Z',
  });
  assert.ok(!JSON.stringify(payload).includes('u1'));
});

test('threshold: the 5th distinct account flags the tour once, the 4th does not; tour stays public', async () => {
  const k = kit();
  for (const u of ['u1', 'u2', 'u3', 'u4']) {
    const r = await k.report.execute({ tourId: PUBLIC_ID, reporterId: u, reason: 'spam' });
    assert.equal(r.flagged, false, `${u} must not flag`);
  }
  assert.equal(k.tourRepo.flags.get(PUBLIC_ID).reportFlaggedAt, null);
  k.advance(60_000);
  const fifth = await k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u5', reason: 'offensive' });
  assert.equal(fifth.flagged, true);
  const flaggedAt = k.tourRepo.flags.get(PUBLIC_ID).reportFlaggedAt;
  assert.equal(flaggedAt.getTime(), NOW + 60_000);

  k.advance(60_000);
  const sixth = await k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u6', reason: 'spam' });
  assert.equal(sixth.flagged, true);
  assert.equal(k.tourRepo.flags.get(PUBLIC_ID).reportFlaggedAt, flaggedAt); // set only once
  assert.equal(k.tourRepo.flags.get(PUBLIC_ID).openReportCount, 6);
  assert.equal(k.tourRepo.rows.get(PUBLIC_ID).status, TOUR_STATUS.PUBLIC); // nothing hidden
  assert.deepEqual(k.sent.map((s) => [s.payload.count, s.payload.flagged]), [
    [1, false], [2, false], [3, false], [4, false], [5, true], [6, true],
  ]);
});

test('threshold: reports older than 7 days and non-open reports do not count', async () => {
  const k = kit();
  for (const u of ['o1', 'o2', 'o3']) k.reportRepo.seed({ tourId: PUBLIC_ID, reporterId: u, createdAt: new Date(NOW - 8 * DAY) });
  k.reportRepo.seed({ tourId: PUBLIC_ID, reporterId: 'd1', status: REPORT_STATUS.DISMISSED, createdAt: new Date(NOW - DAY) });
  k.reportRepo.seed({ tourId: PUBLIC_ID, reporterId: 'a1', status: REPORT_STATUS.ACTIONED, createdAt: new Date(NOW - DAY) });
  for (const u of ['u1', 'u2', 'u3']) await k.report.execute({ tourId: PUBLIC_ID, reporterId: u, reason: 'spam' });
  const fourth = await k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u4', reason: 'spam' });
  assert.equal(fourth.flagged, false); // 4 recent open + 3 old + 2 closed
  // Exactly at the window edge (7 days ago) still counts.
  k.reportRepo.seed({ tourId: PUBLIC_ID, reporterId: 'edge', createdAt: new Date(NOW - 7 * DAY) });
  const fifth = await k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u5', reason: 'spam' });
  assert.equal(fifth.flagged, true);
});

test('errors: duplicate 409, own tour 403, non-public 404, other without note 400; nothing saved or sent', async () => {
  const k = kit();
  await k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u1', reason: 'spam' });
  await assert.rejects(k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u1', reason: 'offensive' }), { status: 409, code: 'already_reported' });
  await assert.rejects(k.report.execute({ tourId: PUBLIC_ID, reporterId: 'author', reason: 'spam' }), { status: 403, code: 'own_tour' });
  await assert.rejects(k.report.execute({ tourId: DRAFT_ID, reporterId: 'u2', reason: 'spam' }), { status: 404, code: 'tour_not_found' });
  await assert.rejects(k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u2', reason: 'other' }), { status: 400, message: 'Vui lòng mô tả lý do' });
  await assert.rejects(k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u2' }), { status: 400, message: 'Vui lòng chọn lý do báo cáo' });
  assert.equal(k.reportRepo.rows.length, 1);
  assert.equal(k.tourRepo.flags.get(PUBLIC_ID).openReportCount, 1);
  assert.equal(k.sent.length, 1);
});

test('a failed publish is only logged: the report is saved and the request succeeds', async () => {
  const k = kit({ publish: async () => { throw new Error('broker down'); } });
  const r = await k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u1', reason: 'spam' });
  assert.equal(r.report.reason, 'spam');
  assert.equal(k.reportRepo.rows.length, 1);
  assert.equal(k.warnings.length, 1);
  assert.match(k.warnings[0], /broker down/);

  // No broker at all (reportEvents null): nothing sent, no warning.
  const quiet = new ReportTour({ tourRepo: k.tourRepo, reportRepo: k.reportRepo, reportEvents: null, logger: { warn: () => assert.fail('no warn') } });
  assert.equal((await quiet.execute({ tourId: PUBLIC_ID, reporterId: 'u2', reason: 'spam' })).flagged, false);
});

test('my report: null before, reason / note / date after, 404 for a non-public tour', async () => {
  const k = kit();
  assert.deepEqual(await k.mine.execute({ tourId: PUBLIC_ID, reporterId: 'u1' }), { report: null });
  await k.report.execute({ tourId: PUBLIC_ID, reporterId: 'u1', reason: 'other', note: 'Ảnh lấy của người khác' });
  assert.deepEqual(await k.mine.execute({ tourId: PUBLIC_ID, reporterId: 'u1' }), {
    report: { reason: 'other', note: 'Ảnh lấy của người khác', createdAt: new Date(NOW) },
  });
  await assert.rejects(k.mine.execute({ tourId: DRAFT_ID, reporterId: 'u1' }), { status: 404 });
});

test('publisher: optional recipient fields dropped when missing, payload valid', async () => {
  const sent = [];
  const pub = new EventTourReportPublisher({ publish: async (e, p) => sent.push(validateEvent(e, p)), clock: () => new Date(NOW) });
  const p = await pub.reported({ id: PUBLIC_ID, authorId: null, title: '' }, { count: 5, reason: 'copyright', flagged: true });
  assert.equal(p.contributorId, undefined);
  assert.equal(p.tourTitle, undefined);
  assert.equal(JSON.parse(JSON.stringify(p)).contributorId, undefined); // dropped on the wire
  assert.equal(sent[0].flagged, true);
  assert.throws(() => validateEvent(TOUR_REPORTED, { ...p, reason: 'boring' }));
});

// ---------- HTTP ----------
test('HTTP: signed-in report and my report, status codes and validation', async () => {
  const k = kit();
  const controller = new TourReportController({ reportTour: k.report, getMyTourReport: k.mine });
  // Stand-in for shared verifyJwt(): "Bearer <userId>".
  const requireAuth = (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    req.user = { sub: h.slice(7), role: 'tourist' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/', buildTourReportRouter({ tourReportController: controller, requireAuth }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = (who) => ({ authorization: `Bearer ${who}`, 'content-type': 'application/json' });
  const post = (who, body, id = PUBLIC_ID) => fetch(`${base}/${id}/reports`, { method: 'POST', headers: as(who), body: JSON.stringify(body) });
  const json = async (res) => ({ status: res.status, body: await res.json() });
  try {
    assert.equal((await fetch(`${base}/${PUBLIC_ID}/reports`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/${PUBLIC_ID}/reports/mine`)).status, 401);

    let r = await json(await post('u1', {}));
    assert.deepEqual([r.status, r.body.error], [400, 'Vui lòng chọn lý do báo cáo']);
    r = await json(await post('u1', { reason: '' }));
    assert.deepEqual([r.status, r.body.error], [400, 'Vui lòng chọn lý do báo cáo']);
    r = await json(await post('u1', { reason: 'boring' }));
    assert.deepEqual([r.status, r.body.error], [400, 'Lý do báo cáo không hợp lệ']);
    r = await json(await post('u1', { reason: 'other', note: '  ' }));
    assert.deepEqual([r.status, r.body.error], [400, 'Vui lòng mô tả lý do']);
    assert.equal((await post('u1', { reason: 'spam', note: 'x'.repeat(REPORT_NOTE_MAX + 1) })).status, 400);

    assert.deepEqual((await json(await fetch(`${base}/${PUBLIC_ID}/reports/mine`, { headers: as('u1') }))).body, { report: null });

    r = await json(await post('u1', { reason: 'false_info', note: 'Sai địa chỉ' }));
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.body).sort(), ['flagged', 'report']);
    assert.deepEqual(Object.keys(r.body.report).sort(), ['createdAt', 'id', 'note', 'reason']);
    assert.equal(r.body.flagged, false);

    r = await json(await post('u1', { reason: 'spam' }));
    assert.deepEqual([r.status, r.body.code], [409, 'already_reported']);
    r = await json(await post('author', { reason: 'spam' }));
    assert.deepEqual([r.status, r.body.code], [403, 'own_tour']);
    r = await json(await post('u2', { reason: 'spam' }, DRAFT_ID));
    assert.deepEqual([r.status, r.body.code], [404, 'tour_not_found']);
    assert.equal((await post('u2', { reason: 'spam' }, 'not-a-uuid')).status, 404); // route needs a UUID

    const mine = await json(await fetch(`${base}/${PUBLIC_ID}/reports/mine`, { headers: as('u1') }));
    assert.equal(mine.status, 200);
    assert.deepEqual([mine.body.report.reason, mine.body.report.note], ['false_info', 'Sai địa chỉ']);

    for (const u of ['u2', 'u3', 'u4']) assert.equal((await post(u, { reason: 'spam' })).status, 201);
    r = await json(await post('u5', { reason: 'offensive' }));
    assert.deepEqual([r.status, r.body.flagged], [201, true]);
  } finally {
    await new Promise((res) => server.close(res));
  }
});
