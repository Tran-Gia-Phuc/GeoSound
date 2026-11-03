// =========================================================
// UC22 (#275) — admin dashboard, action log and account.moderated log rows; UC21 (#274) step 2 —
// violation history. Fakes only: no DB, no broker. account.moderated payloads are validated with the
// shared zod contract (test/helpers/shared-events.js). The router is tested over a local HTTP server on
// 127.0.0.1 with a stand-in for verifyJwt(['admin']).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { validateEvent, EVENTS } from './helpers/shared-events.js';
import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { AdminAction, assertAdminActionEntry, ADMIN_ACTIONS } from '../src/domain/entities/admin-action.js';
import {
  resolveDashboardPeriod,
  resolveLogPeriod,
  averageReviewSeconds,
  rankTopContributors,
  secondsToHours,
  accountActionSourceKey,
  inPeriod,
} from '../src/domain/tour/admin-insights.js';
import {
  GetAdminDashboard,
  ListAdminActions,
  GetAdminAction,
  GetUserViolations,
  RecordAccountAction,
} from '../src/application/use-cases/admin-insights.js';
import { ApplyModerationResult } from '../src/application/use-cases/apply-moderation-result.js';
import { PrismaAdminActionRepository } from '../src/infrastructure/persistence/prisma-admin-action-repository.js';
import { PrismaTourRepository } from '../src/infrastructure/persistence/prisma-tour-repository.js';
import {
  buildAccountModeratedHandler,
  ADMIN_LOG_QUEUE,
  ADMIN_LOG_BINDINGS,
} from '../src/interfaces/events/account-moderated-handler.js';
import { AdminInsightController } from '../src/interfaces/http/controllers/admin-insight-controller.js';
import { buildAdminInsightRouter } from '../src/interfaces/http/routes/admin-insight-routes.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const clock = () => NOW;
const H = 3600 * 1000;
const D = 24 * H;
const ago = (ms) => new Date(NOW.getTime() - ms);

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const U4 = '44444444-4444-4444-8444-444444444444';
const ADM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADM2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING = '99999999-9999-4999-8999-999999999999';

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

// --- fakes: one in-memory store behind adminActionRepo + adminInsightRepo, same rules as the SQL ---

function fakeStore({ tours = [], reports = [], reviewActions = [], log = [] } = {}) {
  const rows = [...log];
  const keys = new Set();

  const adminActionRepo = {
    rows,
    async append(entry) {
      assertAdminActionEntry(entry);
      const row = new AdminAction({ id: uuid(), createdAt: NOW, ...entry });
      rows.push(row);
      return row;
    },
    async appendOnce(entry, sourceKey) {
      assertAdminActionEntry(entry);
      if (keys.has(sourceKey)) return false;
      keys.add(sourceKey);
      rows.push(new AdminAction({ id: uuid(), ...entry, sourceKey, createdAt: entry.createdAt ?? NOW }));
      return true;
    },
    async findById(id) { return rows.find((r) => r.id === id) ?? null; },
    async listByTarget(targetType, targetId, { limit = 100 } = {}) {
      return newest(rows.filter((r) => r.targetType === targetType && r.targetId === targetId)).slice(0, limit);
    },
    async listRecent({ skip = 0, take = 20, action, adminId, targetType, targetId, from, to } = {}) {
      const items = newest(rows.filter((r) =>
        (!action || r.action === action) && (!adminId || r.adminId === adminId) &&
        (!targetType || r.targetType === targetType) && (!targetId || r.targetId === targetId) &&
        inPeriod(r.createdAt, { from, to })));
      return { items: items.slice(skip, skip + take), total: items.length };
    },
  };

  const countBy = (list, key) => list.reduce((acc, x) => ({ ...acc, [x[key]]: (acc[x[key]] ?? 0) + 1 }), {});
  const adminInsightRepo = {
    async countReviewQueue() {
      const c = countBy(tours.filter((t) => ['pending_review', 'ai_warning'].includes(t.status)), 'status');
      return { pending_review: c.pending_review ?? 0, ai_warning: c.ai_warning ?? 0 };
    },
    async averageReviewSeconds(period) {
      return averageReviewSeconds(rows.filter((r) =>
        ['approve_tour', 'reject_tour', 'request_tour_changes'].includes(r.action) && inPeriod(r.createdAt, period)));
    },
    async countReportedTours(period) {
      return new Set(reports.filter((r) => inPeriod(r.createdAt, period)).map((r) => r.tourId)).size;
    },
    async countOpenReportTours() { return tours.filter((t) => t.openReportCount > 0).length; },
    async topContributors(period, { limit }) {
      const authorOf = new Map(tours.map((t) => [t.id, t.authorId]));
      const hidden = new Set(rows
        .filter((r) => r.action === 'hide_tour' && inPeriod(r.createdAt, period) && authorOf.has(r.targetId))
        .map((r) => authorOf.get(r.targetId)));
      return rankTopContributors(tours, hidden, limit);
    },
    async countActionsByType(period) { return countBy(rows.filter((r) => inPeriod(r.createdAt, period)), 'action'); },
    async countToursByStatus(authorId) { return countBy(tours.filter((t) => t.authorId === authorId), 'status'); },
    async listHiddenTours(authorId, { limit }) {
      return tours.filter((t) => t.authorId === authorId && t.status === 'hidden').slice(0, limit).map((t) => {
        const last = newest(rows.filter((r) => r.action === 'hide_tour' && r.targetId === t.id))[0];
        return { id: t.id, title: t.title, hiddenAt: last?.createdAt ?? null, reason: last?.reason ?? null };
      });
    },
    async listRejectedTours(authorId, { limit }) {
      return tours.filter((t) => t.authorId === authorId && t.status === 'rejected').slice(0, limit).map((t) => {
        const last = reviewActions.filter((a) => a.tourId === t.id && a.action === 'reject').sort((a, b) => b.createdAt - a.createdAt)[0];
        return { id: t.id, title: t.title, rejectedAt: last?.createdAt ?? null, reason: t.reviewReason ?? null };
      });
    },
    async countReportsOnAuthorTours(authorId) {
      const mine = new Set(tours.filter((t) => t.authorId === authorId).map((t) => t.id));
      return countBy(reports.filter((r) => mine.has(r.tourId)), 'status');
    },
  };
  return { rows, adminActionRepo, adminInsightRepo };
}

function newest(list) {
  return [...list].sort((a, b) => b.createdAt - a.createdAt || String(b.id).localeCompare(String(a.id)));
}

const tour = (id, props = {}) => {
  const t = new Tour({ id, title: `Tour ${id.slice(0, 4)}`, originalLanguage: 'vi', authorId: U1, status: 'public',
    averageRating: 0, ratingCount: 0, ...props });
  t.openReportCount = props.openReportCount ?? 0;
  return t;
};
const entry = (action, props = {}) => new AdminAction({
  id: uuid(), adminId: ADM, action, targetType: action.endsWith('_user') ? 'user' : 'tour',
  targetId: U4, reason: null, data: {}, createdAt: ago(H), ...props,
});
const fakeLogger = () => {
  const lines = [];
  return { lines, info: (m) => lines.push(['info', m]), error: (m) => lines.push(['error', m]), warn: (m) => lines.push(['warn', m]) };
};

// Fixed data: 7-day default period ends at NOW.
function seeded() {
  const tA = ['a0000001-0000-4000-8000-000000000001', 'a0000002-0000-4000-8000-000000000002', 'a0000003-0000-4000-8000-000000000003'];
  const tB = ['b0000001-0000-4000-8000-000000000001', 'b0000002-0000-4000-8000-000000000002'];
  const tC = 'c0000001-0000-4000-8000-000000000001';
  const tD = 'd0000001-0000-4000-8000-000000000001';
  const tours = [
    // author U1: 2 public tours >= 4 (+1 public at 3.5 left out) -> 2 tours, average (4.5 + 4.0) / 2
    tour(tA[0], { authorId: U1, averageRating: 4.5, ratingCount: 3 }),
    tour(tA[1], { authorId: U1, averageRating: 4.0, ratingCount: 1 }),
    tour(tA[2], { authorId: U1, averageRating: 3.5, ratingCount: 2, openReportCount: 2 }),
    // author U2: 2 public tours at 5.0, but one of their tours was hidden in the period -> left out
    tour(tB[0], { authorId: U2, averageRating: 5, ratingCount: 4 }),
    tour(tB[1], { authorId: U2, status: 'hidden', averageRating: 5, ratingCount: 2 }),
    // author U3: one public tour at 4.8 -> 1 tour; a hide 30 days ago does not count
    tour(tC, { authorId: U3, averageRating: 4.8, ratingCount: 5, openReportCount: 1 }),
    // queue
    tour(tD, { authorId: U3, status: 'pending_review' }),
    tour('e0000001-0000-4000-8000-000000000001', { authorId: U4, status: 'ai_warning' }),
    tour('e0000002-0000-4000-8000-000000000002', { authorId: U4, status: 'pending_review' }),
    // public but unrated (average 0) -> never a top contributor
    tour('e0000003-0000-4000-8000-000000000003', { authorId: U4 }),
  ];
  const reports = [
    { tourId: tA[2], status: 'open', createdAt: ago(D) },
    { tourId: tA[2], status: 'open', createdAt: ago(2 * D) },
    { tourId: tC, status: 'open', createdAt: ago(10 * D) }, // outside the 7 days
    { tourId: tB[1], status: 'actioned', createdAt: ago(3 * D) },
  ];
  const log = [
    // decisions in the period: 2 h and 4 h in queue -> 3 h; one without queuedAt is left out
    entry('approve_tour', { targetId: tA[0], createdAt: ago(2 * D), data: { fromStatus: 'pending_review', queuedAt: new Date(ago(2 * D).getTime() - 2 * H).toISOString() } }),
    entry('reject_tour', { adminId: ADM2, targetId: tA[1], createdAt: ago(D), reason: 'Sai', data: { fromStatus: 'ai_warning', queuedAt: new Date(ago(D).getTime() - 4 * H).toISOString() } }),
    entry('request_tour_changes', { targetId: tC, createdAt: ago(3 * D), data: { fromStatus: 'pending_review' } }),
    // decision outside the period (20 h in queue) must not move the average
    entry('approve_tour', { targetId: tC, createdAt: ago(9 * D), data: { fromStatus: 'pending_review', queuedAt: new Date(ago(9 * D).getTime() - 20 * H).toISOString() } }),
    entry('hide_tour', { targetId: tB[1], createdAt: ago(3 * D), reason: 'Spam' }),
    entry('hide_tour', { targetId: tC, createdAt: ago(30 * D), reason: 'Cũ' }),
    entry('restore_tour', { targetId: tC, createdAt: ago(29 * D) }),
    entry('suspend_user', { targetId: U2, createdAt: ago(H), reason: 'Tái phạm', data: { until: '2026-11-10T00:00:00.000Z' } }),
  ];
  const reviewActions = [];
  return { ids: { tA, tB, tC, tD }, ...fakeStore({ tours, reports, log, reviewActions }), tours, reports, reviewActions };
}

// ---------- domain ----------

test('dashboard period: default last 7 days, whole UTC days, order and 366-day limit', () => {
  const def = resolveDashboardPeriod({}, NOW);
  assert.equal(def.to.toISOString(), NOW.toISOString());
  assert.equal(def.from.toISOString(), '2026-10-27T12:00:00.000Z');
  const days = resolveDashboardPeriod({ from: '2026-11-01', to: '2026-11-02' }, NOW);
  assert.equal(days.from.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(days.to.toISOString(), '2026-11-03T00:00:00.000Z'); // `to` day included
  const onlyTo = resolveDashboardPeriod({ to: '2026-10-10T00:00:00Z' }, NOW);
  assert.equal(onlyTo.from.toISOString(), '2026-10-03T00:00:00.000Z');
  assert.ok(resolveDashboardPeriod({ from: '2025-11-03', to: '2026-11-02' }, NOW)); // 365 days
  assert.throws(() => resolveDashboardPeriod({ from: '2025-01-01', to: '2026-11-02' }, NOW), (e) => e.status === 400);
  assert.throws(() => resolveDashboardPeriod({ from: '2026-11-02', to: '2026-11-01' }, NOW), (e) => e.status === 400);
  assert.throws(() => resolveDashboardPeriod({ from: 'yesterday' }, NOW), (e) => e.status === 400);
  const open = resolveLogPeriod({ from: '2026-11-01' });
  assert.equal(open.to, null);
  assert.deepEqual(resolveLogPeriod({}), { from: null, to: null });
  assert.throws(() => resolveLogPeriod({ from: '2026-11-02', to: '2026-11-01' }), (e) => e.status === 400);
});

test('average review time: decisions with a queuedAt not after the decision; hours with 2 decimals', () => {
  const at = new Date('2026-11-01T10:00:00Z');
  assert.equal(averageReviewSeconds([]), null);
  assert.equal(averageReviewSeconds([
    { createdAt: at, data: { queuedAt: '2026-11-01T09:00:00Z' } },
    { createdAt: at, data: { queuedAt: '2026-11-01T07:00:00Z' } },
    { createdAt: at, data: {} },
    { createdAt: at, data: { queuedAt: '2026-11-01T11:00:00Z' } }, // after the decision: ignored
  ]), 2 * 3600);
  assert.equal(secondsToHours(null), 0);
  assert.equal(secondsToHours(5000), 1.39);
});

test('top contributors: public tours rated >= 4, no hide in the period, ranked, top 5', () => {
  const t = (authorId, averageRating, status = 'public', ratingCount = 1) => ({ authorId, averageRating, status, ratingCount });
  const ranked = rankTopContributors([
    t('a', 4), t('a', 5), t('a', 3.9), t('b', 4.2), t('b', 4.4), t('c', 5), t('c', 5, 'hidden'),
    t('d', 4, 'public', 0), t('e', 4.5), t('f', 4.1), t('g', 4.9), t('h', 4.7),
  ], new Set(['e']));
  assert.deepEqual(ranked.map((r) => r.authorId), ['a', 'b', 'c', 'g', 'h']);
  assert.deepEqual(ranked[0], { authorId: 'a', publicTours: 2, averageRating: 4.5 });
  assert.equal(ranked[1].averageRating, 4.3);
  assert.equal(accountActionSourceKey({ userId: 'u', action: 'ban', at: '2026-11-03T00:00:00Z' }),
    'account.moderated:u:ban:2026-11-03T00:00:00Z');
});

// ---------- dashboard ----------

test('dashboard: metrics of the default period on fixed data', async () => {
  const s = seeded();
  const out = await new GetAdminDashboard({ adminInsightRepo: s.adminInsightRepo, clock }).execute();
  assert.equal(out.from, '2026-10-27T12:00:00.000Z');
  assert.equal(out.to, NOW.toISOString());
  assert.deepEqual(out.pendingReview, { pending_review: 2, ai_warning: 1, total: 3 });
  assert.equal(out.averageReviewHours, 3);
  assert.equal(out.reportedTours, 2); // tA[2] (two reports) + tB[1]; tC's report is 10 days old
  assert.equal(out.openReportTours, 2);
  assert.deepEqual(out.topContributors, [
    { authorId: U1, publicTours: 2, averageRating: 4.25 },
    { authorId: U3, publicTours: 1, averageRating: 4.8 },
  ]);
  assert.deepEqual(out.actionsByType, { approve_tour: 1, reject_tour: 1, request_tour_changes: 1, hide_tour: 1, suspend_user: 1 });
});

test('dashboard: another period (A1) changes the period metrics only', async () => {
  const s = seeded();
  const uc = new GetAdminDashboard({ adminInsightRepo: s.adminInsightRepo, clock });
  const out = await uc.execute({ from: '2026-10-01', to: '2026-10-28' });
  assert.equal(out.averageReviewHours, 20); // only the decision 9 days ago
  assert.equal(out.reportedTours, 1); // tC's report 10 days ago
  assert.deepEqual(out.pendingReview.total, 3); // snapshot
  // U3's tour was hidden 30 days ago (2026-10-04): U3 is left out in this period; U2's hide is later
  assert.deepEqual(out.topContributors.map((c) => c.authorId), [U1, U2]);
  assert.deepEqual(out.actionsByType, { approve_tour: 1, hide_tour: 1, restore_tour: 1 });
  await assert.rejects(uc.execute({ from: '2024-01-01' }), (e) => e.status === 400);
});

test('dashboard: no data -> zeros and empty lists (E1)', async () => {
  const s = fakeStore();
  const out = await new GetAdminDashboard({ adminInsightRepo: s.adminInsightRepo, clock }).execute();
  assert.deepEqual(
    { ...out, from: undefined, to: undefined },
    {
      from: undefined, to: undefined,
      pendingReview: { pending_review: 0, ai_warning: 0, total: 0 },
      averageReviewHours: 0, reportedTours: 0, openReportTours: 0, topContributors: [], actionsByType: {},
    },
  );
});

// ---------- log ----------

test('log: newest first, filters (admin, action, target, period) and paging', async () => {
  const s = seeded();
  const uc = new ListAdminActions({ adminActionRepo: s.adminActionRepo });
  const all = await uc.execute();
  assert.equal(all.total, 8);
  assert.equal(all.items[0].action, 'suspend_user');
  assert.deepEqual(Object.keys(all.items[0]).sort(), ['action', 'adminId', 'createdAt', 'data', 'id', 'reason', 'targetId', 'targetType']);
  for (let i = 1; i < all.items.length; i += 1) assert.ok(all.items[i - 1].createdAt >= all.items[i].createdAt);

  assert.deepEqual((await uc.execute({ adminId: ADM2 })).items.map((a) => a.action), ['reject_tour']);
  assert.equal((await uc.execute({ action: 'hide_tour' })).total, 2);
  assert.deepEqual((await uc.execute({ targetType: 'user' })).items.map((a) => a.targetId), [U2]);
  assert.equal((await uc.execute({ targetId: s.ids.tC })).total, 4);
  assert.equal((await uc.execute({ from: '2026-10-27', to: '2026-11-03' })).total, 5);
  assert.equal((await uc.execute({ to: '2026-10-10' })).total, 2);

  const p2 = await uc.execute({ page: 2, limit: 3 });
  assert.deepEqual([p2.page, p2.limit, p2.total, p2.items.length], [2, 3, 8, 3]);
  assert.deepEqual(p2.items.map((a) => a.id), all.items.slice(3, 6).map((a) => a.id));
  assert.equal((await uc.execute({ limit: 500 })).limit, 100);
  await assert.rejects(uc.execute({ from: '2026-11-02', to: '2026-11-01' }), (e) => e.status === 400);
});

test('log: one entry by id, 404 admin_action_not_found', async () => {
  const s = seeded();
  const uc = new GetAdminAction({ adminActionRepo: s.adminActionRepo });
  const one = await uc.execute({ id: s.rows[1].id });
  assert.equal(one.action, 'reject_tour');
  assert.equal(one.reason, 'Sai');
  await assert.rejects(uc.execute({ id: MISSING }), (e) => e.status === 404 && e.code === 'admin_action_not_found');
});

test('admin action repository: appendOnce uses the unique source key; listRecent builds the filters', async () => {
  const calls = [];
  const prisma = {
    adminAction: {
      async createMany(args) { calls.push(['createMany', args]); return { count: calls.length === 1 ? 1 : 0 }; },
      async findMany(args) { calls.push(['findMany', args]); return []; },
      async count(args) { calls.push(['count', args]); return 0; },
      async findUnique(args) { calls.push(['findUnique', args]); return null; },
    },
  };
  const repo = new PrismaAdminActionRepository(prisma);
  const e = { adminId: ADM, action: 'ban_user', targetType: 'user', targetId: U2, reason: 'x', data: {}, createdAt: NOW };
  assert.equal(await repo.appendOnce(e, 'k1'), true);
  assert.equal(await repo.appendOnce(e, 'k1'), false);
  assert.deepEqual(calls[0][1], { data: [{ ...e, sourceKey: 'k1' }], skipDuplicates: true });
  await assert.rejects(repo.appendOnce(e, ''));
  await assert.rejects(repo.appendOnce({ ...e, action: 'delete_log' }, 'k2'));

  const from = new Date('2026-11-01T00:00:00Z');
  await repo.listRecent({ skip: 20, take: 10, action: 'hide_tour', targetType: 'tour', from });
  const [, find] = calls.find(([k]) => k === 'findMany');
  assert.deepEqual(find.where, { action: 'hide_tour', targetType: 'tour', createdAt: { gte: from } });
  assert.deepEqual([find.skip, find.take], [20, 10]);
  assert.equal(await repo.findById(MISSING), null);
});

// ---------- UC19 decisions also go to the shared log ----------

function fakePrismaForReview({ count = 1, queuedAt = null } = {}) {
  const writes = [];
  const tx = {
    tour: {
      async updateMany(args) { writes.push(['tour.updateMany', args]); return { count }; },
      async findUnique(args) { writes.push(['tour.findUnique', args]); return { reviewQueuedAt: queuedAt }; },
    },
    tourReviewAction: { async create({ data }) { writes.push(['tourReviewAction', data]); return data; } },
    adminAction: { async create({ data }) { writes.push(['adminAction', data]); return { id: 'x', createdAt: NOW, ...data }; } },
  };
  const prisma = {
    transactions: 0,
    async $transaction(fn) { this.transactions += 1; return fn(tx); },
    adminAction: { async create() { throw new Error('outside the transaction'); } },
  };
  return { prisma, writes };
}

test('UC19 decision writes tour_review_actions and admin_actions in the same transaction (with queuedAt)', async () => {
  const queuedAt = new Date('2026-11-03T08:00:00.000Z');
  const { prisma, writes } = fakePrismaForReview({ queuedAt });
  const repo = new PrismaTourRepository(prisma, { actionLog: new PrismaAdminActionRepository(prisma) });
  const n = await repo.applyReviewDecisionIf(U1, ['pending_review', 'ai_warning'], { status: 'rejected', reviewReason: 'Sai' },
    { adminId: ADM, action: 'reject', reason: 'Sai', fromStatus: 'pending_review' });
  assert.equal(n, 1);
  assert.equal(prisma.transactions, 1);
  assert.deepEqual(writes.find(([k]) => k === 'tourReviewAction')[1],
    { tourId: U1, adminId: ADM, action: 'reject', reason: 'Sai', fromStatus: 'pending_review' });
  assert.deepEqual(writes.find(([k]) => k === 'adminAction')[1], {
    adminId: ADM, action: 'reject_tour', targetType: 'tour', targetId: U1, reason: 'Sai',
    data: { fromStatus: 'pending_review', queuedAt: queuedAt.toISOString() },
  });

  for (const [action, expected] of [['approve', 'approve_tour'], ['request_changes', 'request_tour_changes']]) {
    const f = fakePrismaForReview();
    const r = new PrismaTourRepository(f.prisma, { actionLog: new PrismaAdminActionRepository(f.prisma) });
    await r.applyReviewDecisionIf(U1, ['ai_warning'], { status: 'public', reviewReason: null },
      { adminId: ADM, action, reason: null, fromStatus: 'ai_warning' });
    const row = f.writes.find(([k]) => k === 'adminAction')[1];
    assert.equal(row.action, expected);
    assert.deepEqual(row.data, { fromStatus: 'ai_warning' }); // no queued time known (older tour)
  }
});

test('UC19 decision that loses the race writes no log row; without an actionLog only tour_review_actions', async () => {
  const lost = fakePrismaForReview({ count: 0 });
  const repo = new PrismaTourRepository(lost.prisma, { actionLog: new PrismaAdminActionRepository(lost.prisma) });
  assert.equal(await repo.applyReviewDecisionIf(U1, ['pending_review'], { status: 'public', reviewReason: null },
    { adminId: ADM, action: 'approve', reason: null, fromStatus: 'pending_review' }), 0);
  assert.deepEqual(lost.writes.map(([k]) => k), ['tour.updateMany']);

  const plain = fakePrismaForReview();
  await new PrismaTourRepository(plain.prisma).applyReviewDecisionIf(U1, ['pending_review'], { status: 'public', reviewReason: null },
    { adminId: ADM, action: 'approve', reason: null, fromStatus: 'pending_review' });
  assert.deepEqual(plain.writes.map(([k]) => k), ['tour.updateMany', 'tourReviewAction']);
});

test('moderation result: a tour entering the review queue gets reviewQueuedAt; a rejection does not', async () => {
  const fields = [];
  const t = tour(U1, { status: 'ai_checking', moderationRevision: 'r1' });
  const tourRepo = {
    async findById() { return t; },
    async applyModerationResultIf(_id, _rev, f) { fields.push(f); return 1; },
  };
  const uc = new ApplyModerationResult({ tourRepo, placeRepo: {}, clock, logger: fakeLogger() });
  await uc.execute('tour.ai_passed', { tourId: U1, revision: 'r1' });
  await uc.execute('tour.ai_passed', { tourId: U1, revision: 'r1', warning: true, reasons: [] });
  await uc.execute('tour.ai_rejected', { tourId: U1, revision: 'r1', reason: 'x' });
  assert.deepEqual(fields.map((f) => [f.status, f.reviewQueuedAt]), [
    [TOUR_STATUS.PENDING_REVIEW, NOW], [TOUR_STATUS.AI_WARNING, NOW], [TOUR_STATUS.DRAFT, undefined],
  ]);
  // The repository writes it in the same conditional UPDATE as the status.
  const writes = [];
  const repo = new PrismaTourRepository({ tour: { async updateMany(a) { writes.push(a); return { count: 1 }; } } });
  await repo.applyModerationResultIf(U1, 'r1', { status: 'pending_review', moderationReasons: [], reviewQueuedAt: NOW });
  await repo.applyModerationResultIf(U1, 'r1', { status: 'draft', moderationReasons: [] });
  assert.deepEqual(writes[0], {
    where: { id: U1, status: 'ai_checking', moderationRevision: 'r1' },
    data: { status: 'pending_review', moderationReasons: [], reviewQueuedAt: NOW },
  });
  assert.deepEqual(writes[1].data, { status: 'draft', moderationReasons: [] });
});

// ---------- account.moderated -> admin log ----------

const accountEvent = (props = {}) => ({
  userId: U2, action: 'suspend', reason: 'Spam nhiều lần', until: '2026-11-10T03:00:00Z', adminId: ADM,
  email: 'an@mail.com', fullName: 'Nguyễn An', at: '2026-11-03T03:00:00Z', ...props,
});

function handlerSetup() {
  const s = fakeStore();
  const logger = fakeLogger();
  const handler = buildAccountModeratedHandler({
    recordAccountAction: new RecordAccountAction({ adminActionRepo: s.adminActionRepo, logger }),
    validateEvent,
    logger,
  });
  return { ...s, logger, handler };
}

test('account.moderated: one log row per action, no PII, createdAt = event time; duplicate ignored', async () => {
  assert.equal(EVENTS.ACCOUNT_MODERATED, 'account.moderated');
  assert.equal(ADMIN_LOG_QUEUE, 'tour.admin-log');
  assert.deepEqual([...ADMIN_LOG_BINDINGS], ['account.moderated']);
  const s = handlerSetup();
  await s.handler('account.moderated', accountEvent());
  await s.handler('account.moderated', accountEvent()); // redelivery
  assert.equal(s.rows.length, 1);
  const row = s.rows[0].toPublic();
  assert.deepEqual({ ...row, id: undefined }, {
    id: undefined, adminId: ADM, action: 'suspend_user', targetType: 'user', targetId: U2,
    reason: 'Spam nhiều lần', data: { until: '2026-11-10T03:00:00Z' }, createdAt: new Date('2026-11-03T03:00:00Z'),
  });
  assert.equal(JSON.stringify(row).includes('an@mail.com'), false);
  assert.equal(s.rows[0].sourceKey, 'account.moderated:' + U2 + ':suspend:2026-11-03T03:00:00Z');

  for (const [action, expected] of [['warn', 'warn_user'], ['ban', 'ban_user']]) {
    await s.handler('account.moderated', accountEvent({ action, until: undefined, at: '2026-11-03T04:00:00Z' }));
    assert.equal(s.rows.at(-1).action, expected);
    assert.deepEqual(s.rows.at(-1).data, {});
  }
  await s.handler('account.moderated', accountEvent({ action: 'restore', reason: undefined, until: undefined, at: '2026-11-03T05:00:00Z' }));
  assert.equal(s.rows.at(-1).action, 'restore_user');
  assert.equal(s.rows.at(-1).reason, null);
  assert.equal(s.rows.length, 4);
  assert.equal(s.logger.lines.filter(([l]) => l === 'error').length, 0);
});

test('account.moderated: invalid payloads are logged, never thrown, and add no row', async () => {
  const s = handlerSetup();
  const bad = [
    accountEvent({ action: 'ban', until: undefined, reason: undefined }), // reason required
    accountEvent({ action: 'warn' }), // until only for suspend
    accountEvent({ until: undefined }), // suspend without until
    accountEvent({ at: '2026-11-03T03:00:00+07:00' }), // not UTC Z
    accountEvent({ action: 'delete' }),
    accountEvent({ userId: '' }),
    { ...accountEvent(), adminId: undefined },
  ];
  for (const p of bad) await s.handler('account.moderated', p);
  await s.handler('tour.hidden', { tourId: U1, reason: 'x' }); // not bound here: ignored
  assert.equal(s.rows.length, 0);
  assert.equal(s.logger.lines.filter(([l]) => l === 'error').length, bad.length);

  // A repository failure is logged, not thrown (consume() would drop the message anyway).
  const logger = fakeLogger();
  const failing = buildAccountModeratedHandler({
    recordAccountAction: { async execute() { throw new Error('db down'); } }, validateEvent, logger,
  });
  await failing('account.moderated', accountEvent());
  assert.match(logger.lines[0][1], /not logged: db down/);
  assert.throws(() => buildAccountModeratedHandler({ recordAccountAction: {} }));
});

// ---------- UC21 step 2 — violation history ----------

test('violations: tours by status, hidden / rejected tours, reports on the author tours, account actions', async () => {
  const s = seeded();
  const rej = 'f0000001-0000-4000-8000-000000000001';
  s.tours.push(tour(rej, { authorId: U2, status: 'rejected', reviewReason: 'Trùng lặp' }));
  s.reviewActions.push({ tourId: rej, action: 'reject', createdAt: ago(5 * D) });
  s.reports.push({ tourId: s.ids.tB[0], status: 'dismissed', createdAt: ago(D) }, { tourId: s.ids.tB[0], status: 'open', createdAt: ago(D) });
  await s.adminActionRepo.append({ adminId: ADM, action: 'warn_user', targetType: 'user', targetId: U2, reason: 'Nhắc nhở' });

  const uc = new GetUserViolations({ adminInsightRepo: s.adminInsightRepo, adminActionRepo: s.adminActionRepo });
  const out = await uc.execute({ userId: U2 });
  assert.equal(out.userId, U2);
  assert.deepEqual(out.tours, { total: 3, public: 1, hidden: 1, rejected: 1 });
  assert.deepEqual(out.hiddenTours, [{ id: s.ids.tB[1], title: 'Tour b000', hiddenAt: ago(3 * D), reason: 'Spam' }]);
  assert.deepEqual(out.rejectedTours, [{ id: rej, title: 'Tour f000', rejectedAt: ago(5 * D), reason: 'Trùng lặp' }]);
  assert.deepEqual(out.reports, { open: 1, dismissed: 1, actioned: 1 });
  assert.deepEqual(out.accountActions.map((a) => a.action), ['warn_user', 'suspend_user']);

  const empty = await uc.execute({ userId: MISSING });
  assert.deepEqual(empty, {
    userId: MISSING, tours: { total: 0, public: 0, hidden: 0, rejected: 0 }, hiddenTours: [], rejectedTours: [],
    reports: { open: 0, dismissed: 0, actioned: 0 }, accountActions: [],
  });
});

// ---------- HTTP router (local server, guard injected) ----------

// Same rules as shared verifyJwt: 401 without a token, 403 for another role. Token = "role:<r>".
const fakeGuard = (roles) => (req, res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const role = h.slice(7).replace('role:', '');
  if (!roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
  req.user = { sub: ADM, role };
  next();
};

async function withServer(s, fn) {
  const controller = new AdminInsightController({
    getAdminDashboard: new GetAdminDashboard({ adminInsightRepo: s.adminInsightRepo, clock }),
    listAdminActions: new ListAdminActions({ adminActionRepo: s.adminActionRepo }),
    getAdminAction: new GetAdminAction({ adminActionRepo: s.adminActionRepo }),
    getUserViolations: new GetUserViolations({ adminInsightRepo: s.adminInsightRepo, adminActionRepo: s.adminActionRepo }),
  });
  const app = express();
  app.use(express.json());
  app.use('/admin', buildAdminInsightRouter({ adminInsightController: controller, requireAdmin: fakeGuard(['admin']) }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/admin`;
  try {
    await fn(async (path, { method = 'GET', token, body } = {}) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, allow: res.headers.get('allow'), body: await res.json() };
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('router: every route is behind the guard (401 without token, 403 for other roles)', async () => {
  const s = seeded();
  await withServer(s, async (call) => {
    const paths = ['/dashboard', '/actions', `/actions/${s.rows[0].id}`, `/users/${U2}/violations`];
    for (const path of paths) {
      assert.equal((await call(path)).status, 401, path);
      assert.equal((await call(path, { token: 'role:contributor' })).status, 403, path);
      assert.equal((await call(path, { token: 'role:tourist' })).status, 403, path);
      assert.equal((await call(path, { token: 'role:admin' })).status, 200, path);
      assert.equal((await call(path, { method: 'DELETE' })).status, 401, path);
    }
  });
});

test('router: dashboard, log filters, entry, violations, 400 / 404 and append-only (405)', async () => {
  const s = seeded();
  const before = s.rows.length;
  await withServer(s, async (call) => {
    const admin = 'role:admin';
    const d = await call('/dashboard', { token: admin });
    assert.equal(d.body.pendingReview.total, 3);
    assert.equal(d.body.averageReviewHours, 3);
    assert.equal((await call('/dashboard?from=2026-10-01&to=2026-10-28', { token: admin })).body.averageReviewHours, 20);
    for (const qs of ['?from=abc', '?from=2026-13-40', '?from=2024-01-01', '?from=2026-11-02&to=2026-11-01']) {
      const r = await call(`/dashboard${qs}`, { token: admin });
      assert.equal(r.status, 400, qs);
      assert.equal(typeof r.body.error, 'string');
    }

    const list = await call(`/actions?action=hide_tour&limit=1&page=2`, { token: admin });
    assert.equal(list.status, 200);
    assert.deepEqual([list.body.total, list.body.items.length, list.body.items[0].reason], [2, 1, 'Cũ']);
    assert.equal((await call(`/actions?adminId=${ADM2}`, { token: admin })).body.total, 1);
    assert.equal((await call(`/actions?targetType=user&targetId=${U2}`, { token: admin })).body.total, 1);
    assert.equal((await call('/actions?from=2026-10-27T12:00:00Z', { token: admin })).body.total, 5);
    for (const qs of ['?limit=0', '?limit=101', '?page=0', '?action=delete_log', '?targetType=place', '?from=x']) {
      assert.equal((await call(`/actions${qs}`, { token: admin })).status, 400, qs);
    }

    const one = await call(`/actions/${s.rows[0].id}`, { token: admin });
    assert.equal(one.body.action, 'approve_tour');
    const missing = await call(`/actions/${MISSING}`, { token: admin });
    assert.deepEqual([missing.status, missing.body.code], [404, 'admin_action_not_found']);
    assert.equal((await call('/actions/not-a-uuid', { token: admin })).status, 400);

    for (const method of ['PUT', 'PATCH', 'DELETE', 'POST']) {
      for (const path of ['/actions', `/actions/${s.rows[0].id}`, '/dashboard', `/users/${U2}/violations`]) {
        const r = await call(path, { method, token: admin, body: { reason: 'x' } });
        assert.equal(r.status, 405, `${method} ${path}`);
        assert.equal(r.allow, 'GET');
        assert.equal(r.body.code, 'method_not_allowed');
      }
    }

    const v = await call(`/users/${U2}/violations`, { token: admin });
    assert.equal(v.status, 200);
    assert.deepEqual(v.body.tours, { total: 2, public: 1, hidden: 1, rejected: 0 });
    assert.equal(v.body.accountActions[0].action, 'suspend_user');
    assert.equal((await call('/users/nope/violations', { token: admin })).status, 400);
    assert.equal((await call('/unknown', { token: admin })).status, 404);
  });
  assert.equal(s.rows.length, before);
  assert.ok(ADMIN_ACTIONS.includes('restore_user'));
});
