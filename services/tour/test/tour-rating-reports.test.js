// =========================================================
// UC05 — Functional test suite for Rating Reports & Admin Resolution:
//   - Phase 1: Tourist/Author submits report, soft-flag at N >= 3 (R5)
//   - Phase 2: Admin lists queue (A2 filter) & resolves REMOVE_RATING / DISMISS (R6)
//   - Alternative A1: Author dispute priority (reporterRole = 'AUTHOR')
//   - Exceptions E1 (401), E2 (400 cannot_report_own_rating), E3 (409 duplicate),
//     E4 (404 rating_not_found), E5 (403 non-admin)
// Run: node --test test/tour-rating-reports.test.js
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import {
  REPORT_REASONS,
  REPORT_STATUSES,
  RESOLVE_ACTIONS,
  SOFT_FLAG_THRESHOLD,
  normalizeReportInput,
} from '../src/domain/entities/tour-rating-report.js';
import {
  SubmitRatingReport,
  ListAdminRatingReports,
  ResolveRatingReport,
} from '../src/application/use-cases/tour-rating-reports.js';
import { TourRatingReportController } from '../src/interfaces/http/controllers/tour-rating-report-controller.js';
import {
  buildTourRatingReportRouter,
  buildAdminRatingReportRouter,
} from '../src/interfaces/http/routes/tour-rating-report-routes.js';

const TOUR_ID = '11111111-1111-4111-8111-111111111111';
const AUTHOR_ID = '22222222-2222-4222-8222-222222222222';
const REVIEWER_ID = '33333333-3333-4333-8333-333333333333';
const REPORTER_1 = '44444444-4444-4444-8444-444444444444';
const REPORTER_2 = '55555555-5555-4555-8555-555555555555';
const REPORTER_3 = '66666666-6666-4666-8666-666666666666';
const ADMIN_ID = '77777777-7777-4777-8777-777777777777';

class FakeTourRepo {
  constructor(tours) {
    this.rows = new Map(tours.map((t) => [t.id, t]));
  }
  async findPublicById(id) {
    const t = this.rows.get(id);
    return t && t.status === TOUR_STATUS.PUBLIC ? t : null;
  }
}

class FakeRatingReportRepo {
  constructor(tourRepo, initialRatings = []) {
    this.tourRepo = tourRepo;
    this.ratings = new Map(initialRatings.map((r) => [`${r.tourId}:${r.userId}`, { ...r }]));
    this.reports = new Map();
    this.seq = 1;
  }

  async findVisibleRating(tourId, ratingUserId) {
    const r = this.ratings.get(`${tourId}:${ratingUserId}`);
    return r && !r.isHidden ? r : null;
  }

  async findReportByUnique(tourId, ratingUserId, reporterId) {
    for (const rep of this.reports.values()) {
      if (rep.tourId === tourId && rep.ratingUserId === ratingUserId && rep.reporterId === reporterId) {
        return rep;
      }
    }
    return null;
  }

  async createReport({ tourId, ratingId, ratingUserId, reporterId, reporterRole, reasonType, description }) {
    const existing = await this.findReportByUnique(tourId, ratingUserId, reporterId);
    if (existing) return null;

    const id = `88888888-8888-4888-8888-${String(this.seq++).padStart(12, '0')}`;
    const now = new Date();
    const record = {
      id,
      tourId,
      ratingId,
      ratingUserId,
      reporterId,
      reporterRole,
      reasonType,
      description: description ?? null,
      status: REPORT_STATUSES.PENDING,
      adminNote: null,
      resolvedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    this.reports.set(id, record);

    const pendingCount = [...this.reports.values()].filter(
      (r) => r.tourId === tourId && r.ratingUserId === ratingUserId && r.status === REPORT_STATUSES.PENDING,
    ).length;
    const rating = this.ratings.get(`${tourId}:${ratingUserId}`);
    if (rating && pendingCount >= SOFT_FLAG_THRESHOLD) {
      rating.isFlagged = true;
    }
    return { report: record, pendingCount, isFlagged: Boolean(rating?.isFlagged) };
  }

  async listAdminReports({ status = REPORT_STATUSES.PENDING, skip = 0, take = 20 }) {
    const all = [...this.reports.values()]
      .filter((r) => r.status === status)
      .map((r) => {
        const rating = this.ratings.get(`${r.tourId}:${r.ratingUserId}`);
        const tour = this.tourRepo.rows.get(r.tourId);
        const pendingCount = [...this.reports.values()].filter(
          (x) => x.tourId === r.tourId && x.ratingUserId === r.ratingUserId && x.status === REPORT_STATUSES.PENDING,
        ).length;
        return {
          ...r,
          pendingCount,
          rating: rating
            ? {
                id: rating.id,
                userName: rating.userName,
                stars: rating.stars,
                comment: rating.comment,
                isFlagged: Boolean(rating.isFlagged),
                isHidden: Boolean(rating.isHidden),
              }
            : null,
          tour: tour ? { id: tour.id, title: tour.title, city: tour.city ?? null } : null,
        };
      })
      .sort((a, b) => {
        const flagDiff = Number(Boolean(b.rating?.isFlagged)) - Number(Boolean(a.rating?.isFlagged));
        if (flagDiff !== 0) return flagDiff;
        const roleDiff = Number(b.reporterRole === 'AUTHOR') - Number(a.reporterRole === 'AUTHOR');
        if (roleDiff !== 0) return roleDiff;
        return b.createdAt - a.createdAt;
      });
    return { items: all.slice(skip, skip + take), total: all.length };
  }

  async resolveReport({ reportId, action, adminId, adminNote }) {
    const target = this.reports.get(reportId);
    if (!target) return null;
    const rating = this.ratings.get(`${target.tourId}:${target.ratingUserId}`);
    if (!rating) return null;

    const now = new Date();
    let updatedSummary = null;
    const nextStatus =
      action === RESOLVE_ACTIONS.REMOVE_RATING ? REPORT_STATUSES.RESOLVED : REPORT_STATUSES.DISMISSED;

    for (const rep of this.reports.values()) {
      if (rep.tourId === target.tourId && rep.ratingUserId === target.ratingUserId && rep.status === REPORT_STATUSES.PENDING) {
        rep.status = nextStatus;
        rep.adminNote = adminNote ?? null;
        rep.resolvedBy = adminId;
        rep.updatedAt = now;
      }
    }

    if (action === RESOLVE_ACTIONS.DISMISS) {
      rating.isFlagged = false;
      const tour = this.tourRepo.rows.get(target.tourId);
      updatedSummary = { averageRating: tour.averageRating, ratingCount: tour.ratingCount };
    } else if (action === RESOLVE_ACTIONS.REMOVE_RATING) {
      if (!rating.isHidden) {
        rating.isHidden = true;
        const tour = this.tourRepo.rows.get(target.tourId);
        const nextCount = Math.max(tour.ratingCount - 1, 0);
        tour.averageRating =
          nextCount <= 0
            ? 0
            : Math.min(Math.max((tour.averageRating * tour.ratingCount - rating.stars) / nextCount, 0), 5);
        tour.ratingCount = nextCount;
        updatedSummary = { averageRating: tour.averageRating, ratingCount: tour.ratingCount };
      }
    }

    return { report: target, status: nextStatus, summary: updatedSummary };
  }
}

function buildTestServer({ tourRepo, reportRepo }) {
  const submitRatingReport = new SubmitRatingReport({ tourRepo, reportRepo });
  const listAdminRatingReports = new ListAdminRatingReports({ reportRepo });
  const resolveRatingReport = new ResolveRatingReport({ reportRepo });
  const controller = new TourRatingReportController({
    submitRatingReport,
    listAdminRatingReports,
    resolveRatingReport,
  });

  const requireAuth = (req, res, next) => {
    const sub = req.headers['x-test-user'];
    if (!sub) return res.status(401).json({ error: 'Vui lòng đăng nhập', code: 'unauthenticated' });
    req.user = { sub: String(sub), role: String(req.headers['x-test-role'] || 'tourist') };
    next();
  };

  const requireAdmin = (req, res, next) => {
    const sub = req.headers['x-test-user'];
    if (!sub) return res.status(401).json({ error: 'Vui lòng đăng nhập', code: 'unauthenticated' });
    const role = String(req.headers['x-test-role'] || 'tourist');
    if (role !== 'admin') return res.status(403).json({ error: 'Không đủ quyền truy cập', code: 'forbidden' });
    req.user = { sub: String(sub), role };
    next();
  };

  const app = express();
  app.use(express.json());
  app.use('/admin/rating-reports', buildAdminRatingReportRouter({ tourRatingReportController: controller, requireAdmin }));
  app.use('/', buildTourRatingReportRouter({ tourRatingReportController: controller, requireAuth }));
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message, code: err.code || 'internal_error' });
  });
  return app;
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('UC05 Domain: normalizeReportInput validates reasonType and 500-char description', () => {
  const ok = normalizeReportInput({ reasonType: REPORT_REASONS.SPAM, description: '  Spam link  ' });
  assert.deepEqual(ok, { reasonType: 'SPAM', description: 'Spam link' });
  assert.throws(() => normalizeReportInput({ reasonType: 'INVALID' }), { status: 400 });
  assert.throws(() => normalizeReportInput({ reasonType: 'OTHER', description: 'a'.repeat(501) }), { status: 400 });
});

test('UC05 HTTP: full lifecycle — E1..E5, A1 author dispute, R5 soft-flag at 3 reports, A2 filter, REMOVE_RATING atomic aggregate', async () => {
  const tour = new Tour({
    id: TOUR_ID,
    title: 'Di tích Sài Gòn',
    originalLanguage: 'vi',
    authorId: AUTHOR_ID,
    status: TOUR_STATUS.PUBLIC,
    averageRating: 3, // e.g., two ratings: 5 stars + 1 star => avg 3, count 2
    ratingCount: 2,
  });
  const tourRepo = new FakeTourRepo([tour]);
  const ratingId = crypto.randomUUID();
  const reportRepo = new FakeRatingReportRepo(tourRepo, [
    {
      id: ratingId,
      tourId: TOUR_ID,
      userId: REVIEWER_ID,
      userName: 'Khách A',
      stars: 1,
      comment: 'Quảng cáo lừa đảo',
      isFlagged: false,
      isHidden: false,
    },
  ]);

  const app = buildTestServer({ tourRepo, reportRepo });
  await withServer(app, async (base) => {
    const endpoint = `${base}/${TOUR_ID}/ratings/${REVIEWER_ID}/reports`;

    // E1: unauthenticated -> 401
    const unauth = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reasonType: 'SPAM' }),
    });
    assert.equal(unauth.status, 401);

    // E2: cannot report own rating -> 400 cannot_report_own_rating
    const selfRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': REVIEWER_ID, 'x-test-role': 'tourist' },
      body: JSON.stringify({ reasonType: 'SPAM' }),
    });
    assert.equal(selfRes.status, 400);
    assert.equal((await selfRes.json()).code, 'cannot_report_own_rating');

    // Reporter 1 (Tourist) submits report -> 201
    const r1 = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': REPORTER_1, 'x-test-role': 'tourist' },
      body: JSON.stringify({ reasonType: 'SPAM', description: 'Chứa link quảng cáo' }),
    });
    assert.equal(r1.status, 201);
    const b1 = await r1.json();
    assert.equal(b1.report.reporterRole, 'TOURIST');
    assert.equal(b1.isFlagged, false);

    // E3: duplicate report by Reporter 1 -> 409 report_already_submitted
    const dup = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': REPORTER_1, 'x-test-role': 'tourist' },
      body: JSON.stringify({ reasonType: 'SPAM' }),
    });
    assert.equal(dup.status, 409);
    assert.equal((await dup.json()).code, 'report_already_submitted');

    // A1: Tour Author submits dispute -> reporterRole = AUTHOR
    const rAuthor = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': AUTHOR_ID, 'x-test-role': 'contributor' },
      body: JSON.stringify({ reasonType: 'MISLEADING', description: 'Nội dung bôi nhọ sai sự thật' }),
    });
    assert.equal(rAuthor.status, 201);
    const bAuthor = await rAuthor.json();
    assert.equal(bAuthor.report.reporterRole, 'AUTHOR');
    assert.equal(bAuthor.isFlagged, false);

    // R5: 3rd pending report triggers soft-flag (isFlagged = true)
    const r3 = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': REPORTER_2, 'x-test-role': 'tourist' },
      body: JSON.stringify({ reasonType: 'OFFENSIVE' }),
    });
    assert.equal(r3.status, 201);
    const b3 = await r3.json();
    assert.equal(b3.pendingCount, 3);
    assert.equal(b3.isFlagged, true);

    // E5: non-admin accessing admin queue -> 403
    const nonAdmin = await fetch(`${base}/admin/rating-reports?status=pending`, {
      headers: { 'x-test-user': REPORTER_1, 'x-test-role': 'tourist' },
    });
    assert.equal(nonAdmin.status, 403);

    // Phase 2: Admin lists pending reports (AUTHOR report prioritized)
    const queueRes = await fetch(`${base}/admin/rating-reports?status=pending`, {
      headers: { 'x-test-user': ADMIN_ID, 'x-test-role': 'admin' },
    });
    assert.equal(queueRes.status, 200);
    const queue = await queueRes.json();
    assert.equal(queue.total, 3);
    assert.equal(queue.items[0].reporterRole, 'AUTHOR');
    assert.equal(queue.items[0].rating.isFlagged, true);

    // Phase 2: Admin resolves with REMOVE_RATING -> hides rating, recalculates avg (3*2 - 1)/1 = 5, count = 1
    const resolveRes = await fetch(`${base}/admin/rating-reports/${bAuthor.report.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': ADMIN_ID, 'x-test-role': 'admin' },
      body: JSON.stringify({ action: 'REMOVE_RATING', adminNote: 'Vi phạm spam/bôi nhọ' }),
    });
    assert.equal(resolveRes.status, 200);
    const resolved = await resolveRes.json();
    assert.equal(resolved.status, 'RESOLVED');
    assert.deepEqual(resolved.summary, { averageRating: 5, ratingCount: 1 });

    // A2: Admin filters resolved reports
    const resolvedQueue = await (
      await fetch(`${base}/admin/rating-reports?status=resolved`, {
        headers: { 'x-test-user': ADMIN_ID, 'x-test-role': 'admin' },
      })
    ).json();
    assert.equal(resolvedQueue.total, 3);

    // E4: Reporting an already hidden/removed rating -> 404 rating_not_found
    const afterRemove = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': REPORTER_3, 'x-test-role': 'tourist' },
      body: JSON.stringify({ reasonType: 'SPAM' }),
    });
    assert.equal(afterRemove.status, 404);
    assert.equal((await afterRemove.json()).code, 'rating_not_found');
  });
});

test('UC05 HTTP: Admin DISMISS keeps rating visible and clears isFlagged', async () => {
  const tour = new Tour({
    id: TOUR_ID,
    title: 'Tour A',
    originalLanguage: 'vi',
    authorId: AUTHOR_ID,
    status: TOUR_STATUS.PUBLIC,
    averageRating: 4,
    ratingCount: 1,
  });
  const tourRepo = new FakeTourRepo([tour]);
  const ratingKey = `${TOUR_ID}:${REVIEWER_ID}`;
  const reportRepo = new FakeRatingReportRepo(tourRepo, [
    {
      id: crypto.randomUUID(),
      tourId: TOUR_ID,
      userId: REVIEWER_ID,
      userName: 'Khách B',
      stars: 4,
      comment: 'Khá ổn',
      isFlagged: true,
      isHidden: false,
    },
  ]);

  const app = buildTestServer({ tourRepo, reportRepo });
  await withServer(app, async (base) => {
    const repRes = await fetch(`${base}/${TOUR_ID}/ratings/${REVIEWER_ID}/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': REPORTER_1, 'x-test-role': 'tourist' },
      body: JSON.stringify({ reasonType: 'OTHER', description: 'Không thích' }),
    });
    const { report } = await repRes.json();

    const dismissRes = await fetch(`${base}/admin/rating-reports/${report.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': ADMIN_ID, 'x-test-role': 'admin' },
      body: JSON.stringify({ action: 'DISMISS', adminNote: 'Nhận xét hợp lệ' }),
    });
    assert.equal(dismissRes.status, 200);
    const body = await dismissRes.json();
    assert.equal(body.status, 'DISMISSED');
    assert.deepEqual(body.summary, { averageRating: 4, ratingCount: 1 });
    assert.equal(reportRepo.ratings.get(ratingKey).isFlagged, false);
    assert.equal(reportRepo.ratings.get(ratingKey).isHidden, false);
  });
});
