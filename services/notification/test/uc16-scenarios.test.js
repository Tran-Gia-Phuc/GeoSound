// =========================================================
// Use-case scenarios: UC16 (status tracking and in-app notifications), with the UC15 / UC19 / UC06 /
// UC20 / UC21 events that feed it. Each test chains the real code of the journey:
//   event (shared zod contract) -> handleEvent (notify.js) -> storeInApp (container) + email (Auth
//   lookup for contributorId) -> HTTP API (real router, real shared verifyJwt, JWT signed here).
// Fakes only: in-memory repository (test/helpers), recording mailer, fake fetch for Auth. The HTTP
// server listens on 127.0.0.1. No DB, broker or outside network.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import jwt from 'jsonwebtoken';

import { handleEvent } from '../src/notify.js';
import { buildContainer } from '../src/container.js';
import { createContributorLookup } from '../src/services/contributor-lookup.js';
import { MemoryNotificationRepository } from './helpers/memory-repository.js';

// Shared code lives at <repo>/shared (CI) or /app/shared (image): load whichever exists.
async function loadShared(sub) {
  let lastErr;
  for (const rel of [`../../../shared/${sub}`, `../shared/${sub}`]) {
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
const { validateEvent, EVENTS } = await loadShared('events/index.js');
const { verifyJwt, errorHandler } = await loadShared('middleware/index.js');

const SECRET = 'uc16-test-secret';
process.env.JWT_ACCESS_SECRET = SECRET;
const INTERNAL_TOKEN = 'internal-test-token';
const AUTHOR = 'user-author';
const OTHER = 'user-other';
const T0 = Date.parse('2026-11-03T08:00:00Z');
const silent = { log() {}, warn() {}, error() {} };
const at = (min) => new Date(T0 + min * 60_000).toISOString();

// One scenario world: repository + container, recording mailer, fake Auth contact route.
function world({ directory = { [AUTHOR]: 'author@mail.test', [OTHER]: 'other@mail.test' }, authStatus = 200 } = {}) {
  let tick = 0;
  const repo = new MemoryNotificationRepository({ clock: () => new Date(T0 + (tick++) * 60_000) });
  const revoked = new Set();
  const requireAuth = verifyJwt([], { isRevoked: async (sid) => revoked.has(sid) });
  const { storeInApp, notificationRouter } = buildContainer({ repository: repo, requireAuth, logger: silent });

  const authCalls = [];
  const fetchImpl = async (url, init) => {
    authCalls.push({ url, token: init.headers['x-internal-token'] });
    const id = decodeURIComponent(url.match(/\/internal\/users\/([^/]+)\/contact$/)[1]);
    const status = authStatus === 200 && !directory[id] ? 404 : authStatus;
    return { status, ok: status === 200, json: async () => ({ id, email: directory[id] }) };
  };
  const lookupEmail = createContributorLookup({ baseUrl: 'http://auth:3001', token: INTERNAL_TOKEN, fetchImpl });

  const sent = [];
  const mailer = { failNext: null, async send(m) {
    if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
    sent.push(m);
    return { status: 'sent' };
  } };

  // Like shared consume(): the publisher validated the payload, the worker gets the raw JSON.
  async function deliver(event, payload) {
    assert.doesNotThrow(() => validateEvent(event, payload), `${event} must match the shared contract`);
    return handleEvent(mailer, event, JSON.parse(JSON.stringify(payload)), silent, {}, { lookupEmail, storeInApp });
  }
  return { repo, revoked, notificationRouter, authCalls, sent, mailer, deliver };
}

async function serve(t, w) {
  const app = express();
  app.use('/', w.notificationRouter);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, { token, method = 'GET' } = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const tokenOf = (sub, extra = {}, secret = SECRET) => jwt.sign({ sub, role: 'contributor', ...extra }, secret, { expiresIn: '15m' });

// UC15 -> UC19: AI reject, fix, admin asks for changes, admin approves.
async function reviewJourney(w, tourId) {
  const title = 'Phố cổ Hội An';
  await w.deliver(EVENTS.TOUR_AI_REJECTED, {
    tourId, contributorId: AUTHOR, tourTitle: title, revision: at(0), at: at(0),
    reason: 'Mô tả chứa lời lẽ xúc phạm',
    reasons: [{ field: 'description', category: 'hate', message: 'Mô tả chứa lời lẽ xúc phạm', source: 'ai', severity: 0.9 }],
  });
  await w.deliver(EVENTS.TOUR_CHANGES_REQUESTED, { tourId, contributorId: AUTHOR, tourTitle: title, reason: 'Thêm ảnh điểm 2', at: at(10) });
  await w.deliver(EVENTS.TOUR_APPROVED, { tourId, contributorId: AUTHOR, tourTitle: title, adminId: 'admin-1', at: at(20) });
}

test('UC15 -> UC19 review journey: one in-app row per event for the author, email looked up in Auth', async () => {
  const w = world();
  const tourId = crypto.randomUUID();
  await reviewJourney(w, tourId);

  assert.equal(w.repo.rows.length, 3);
  assert.ok(w.repo.rows.every((r) => r.userId === AUTHOR && r.tourId === tourId));
  assert.deepEqual(w.repo.rows.map((r) => r.title), [
    'Tour «Phố cổ Hội An» không qua kiểm duyệt tự động',
    'Tour «Phố cổ Hội An» cần chỉnh sửa',
    'Tour «Phố cổ Hội An» đã được duyệt',
  ]);
  assert.deepEqual(w.repo.rows.map((r) => r.body), ['Mô tả chứa lời lẽ xúc phạm', 'Thêm ảnh điểm 2', null]);
  // AI reasons keep field / category / message only.
  assert.deepEqual(w.repo.rows[0].data, { reasons: [{ field: 'description', category: 'hate', message: 'Mô tả chứa lời lẽ xúc phạm' }] });

  // No contributorEmail in the events: Auth was asked once per email, with the internal token.
  assert.equal(w.authCalls.length, 3);
  assert.ok(w.authCalls.every((c) => c.url === `http://auth:3001/internal/users/${AUTHOR}/contact` && c.token === INTERNAL_TOKEN));
  assert.deepEqual(w.sent.map((m) => m.to), ['author@mail.test', 'author@mail.test', 'author@mail.test']);
  assert.equal(w.sent[1].subject, 'Tour cần chỉnh sửa');
  assert.match(w.sent[2].subject, /được duyệt/);
  assert.match(w.sent[1].text, /Lý do: Thêm ảnh điểm 2/);
});

test('UC19 admin reject: in-app body and email carry the reason', async () => {
  const w = world();
  const tourId = crypto.randomUUID();
  const res = await w.deliver(EVENTS.TOUR_REJECTED, { tourId, contributorId: AUTHOR, tourTitle: 'Chợ Bến Thành', reason: 'Nội dung trùng lặp', at: at(0) });
  assert.deepEqual(res, { sent: { status: 'sent' } });
  assert.equal(w.repo.rows.length, 1);
  assert.equal(w.repo.rows[0].title, 'Tour «Chợ Bến Thành» bị từ chối');
  assert.equal(w.repo.rows[0].body, 'Nội dung trùng lặp');
  assert.match(w.sent[0].text, /Lý do: Nội dung trùng lặp/);
});

test('UC06 -> UC20 journey: reported (in-app only), hidden, restored (in-app + email)', async () => {
  const w = world();
  const tourId = crypto.randomUUID();
  const r1 = await w.deliver(EVENTS.TOUR_REPORTED, { tourId, contributorId: AUTHOR, tourTitle: 'Hồ Gươm', count: 3, reason: 'false_info', flagged: true, at: at(0) });
  await w.deliver(EVENTS.TOUR_HIDDEN, { tourId, contributorId: AUTHOR, tourTitle: 'Hồ Gươm', reason: 'Nhiều báo cáo sai sự thật', at: at(5) });
  await w.deliver(EVENTS.TOUR_RESTORED, { tourId, contributorId: AUTHOR, tourTitle: 'Hồ Gươm', reason: 'Báo cáo không đúng', at: at(9) });

  assert.deepEqual(r1, { skipped: 'no_template' }); // no email for a report
  assert.deepEqual(w.repo.rows.map((r) => r.type), ['tour.reported', 'tour.hidden', 'tour.restored']);
  assert.deepEqual(w.repo.rows[0].data, { count: 3, flagged: true });
  assert.equal(w.repo.rows[1].title, 'Tour «Hồ Gươm» đã bị ẩn');
  assert.equal(w.repo.rows[2].title, 'Tour «Hồ Gươm» đã được hiển thị lại');
  assert.equal(w.sent.length, 2);
  assert.equal(w.authCalls.length, 2);
});

test('UC21 account.moderated: in-app for userId (no tour), email to the event address without a lookup', async () => {
  const w = world();
  await w.deliver(EVENTS.ACCOUNT_MODERATED, {
    userId: AUTHOR, action: 'suspend', reason: 'Spam nhiều tour', until: '2026-11-10T03:00:00Z',
    adminId: 'admin-1', email: 'author@mail.test', fullName: 'Nguyễn An', at: at(0),
  });
  await w.deliver(EVENTS.ACCOUNT_MODERATED, { userId: AUTHOR, action: 'restore', adminId: 'admin-1', email: 'author@mail.test', at: at(30) });

  assert.deepEqual(w.repo.rows.map((r) => [r.userId, r.tourId, r.title]), [
    [AUTHOR, null, 'Tài khoản của bạn bị tạm khoá đến 10:00 10/11/2026'],
    [AUTHOR, null, 'Tài khoản của bạn đã được khôi phục'],
  ]);
  assert.equal(w.authCalls.length, 0);
  assert.deepEqual(w.sent.map((m) => m.to), ['author@mail.test', 'author@mail.test']);
});

test('contributorEmail in the event is used as is: no Auth lookup', async () => {
  const w = world();
  await w.deliver(EVENTS.TOUR_APPROVED, { tourId: crypto.randomUUID(), contributorId: AUTHOR, contributorEmail: 'direct@mail.test', adminId: 'a', at: at(0) });
  assert.equal(w.authCalls.length, 0);
  assert.equal(w.sent[0].to, 'direct@mail.test');
  assert.equal(w.repo.rows.length, 1);
});

test('Auth lookup finds nobody (404) or fails (500): in-app row kept, no email, no throw', async () => {
  for (const [opts, label] of [[{ directory: {} }, '404'], [{ authStatus: 500 }, '500']]) {
    const w = world(opts);
    const res = await w.deliver(EVENTS.TOUR_REJECTED, { tourId: crypto.randomUUID(), contributorId: AUTHOR, reason: 'Sai', at: at(0) });
    assert.deepEqual(res, { skipped: 'no_recipient' }, label);
    assert.equal(w.sent.length, 0, label);
    assert.equal(w.repo.rows.length, 1, label);
    assert.equal(w.repo.rows[0].title, 'Tour của bạn bị từ chối', label);
  }
});

test('SMTP failure: the in-app row is already stored and the error reaches the broker (nack)', async () => {
  const w = world();
  w.mailer.failNext = new Error('SMTP down');
  await assert.rejects(w.deliver(EVENTS.TOUR_HIDDEN, { tourId: crypto.randomUUID(), contributorId: AUTHOR, reason: 'x', at: at(0) }), /SMTP down/);
  assert.equal(w.repo.rows.length, 1);
});

test('duplicate delivery: one in-app row; the email is sent again (current behaviour); a new event is a new row', async () => {
  const w = world();
  const payload = { tourId: crypto.randomUUID(), contributorId: AUTHOR, tourTitle: 'A', reason: 'Sửa mô tả', at: at(0) };
  await w.deliver(EVENTS.TOUR_CHANGES_REQUESTED, payload);
  await w.deliver(EVENTS.TOUR_CHANGES_REQUESTED, { ...payload });
  assert.equal(w.repo.rows.length, 1);
  // Email has no dedupe: the redelivered message mails the author a second time.
  assert.equal(w.sent.length, 2);
  await w.deliver(EVENTS.TOUR_CHANGES_REQUESTED, { ...payload, at: at(1) });
  assert.equal(w.repo.rows.length, 2);
});

test('tour.ai_passed (warning) is not a Notification event: nothing stored, nothing sent', async () => {
  const w = world();
  const res = await w.deliver(EVENTS.TOUR_AI_PASSED, {
    tourId: crypto.randomUUID(), contributorId: AUTHOR, revision: at(0), warning: true, severity: 0.55,
    reasons: [{ field: 'description', category: 'misleading', message: 'Có thể sai', source: 'ai' }],
  });
  assert.deepEqual(res, { skipped: 'no_template' });
  assert.equal(w.repo.rows.length, 0);
  assert.equal(w.sent.length, 0);
});

test('HTTP: the author lists the journey newest first, filters by tourId, counts unread', async (t) => {
  const w = world();
  const tourA = crypto.randomUUID();
  const tourB = crypto.randomUUID();
  await reviewJourney(w, tourA);
  await w.deliver(EVENTS.TOUR_REJECTED, { tourId: tourB, contributorId: AUTHOR, tourTitle: 'B', reason: 'Trùng', at: at(30) });
  const call = await serve(t, w);
  const token = tokenOf(AUTHOR);

  let r = await call('/', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 4);
  assert.equal(r.body.unread, 4);
  assert.deepEqual(r.body.items.map((i) => i.type), ['tour.rejected', 'tour.approved', 'tour.changes_requested', 'tour.ai_rejected']);
  assert.deepEqual(Object.keys(r.body.items[0]).sort(), ['body', 'createdAt', 'data', 'id', 'read', 'title', 'tourId', 'type']);

  r = await call(`/?tourId=${tourA}`, { token });
  assert.equal(r.body.total, 3);
  assert.ok(r.body.items.every((i) => i.tourId === tourA));
  assert.equal(r.body.items[2].data.reasons[0].category, 'hate'); // moderation history of the tour
  assert.equal(r.body.unread, 4); // badge count stays global

  assert.deepEqual((await call('/unread-count', { token })).body, { unread: 4 });
});

test('HTTP: mark one read, then all read; the badge count follows', async (t) => {
  const w = world();
  await reviewJourney(w, crypto.randomUUID());
  const call = await serve(t, w);
  const token = tokenOf(AUTHOR);
  const [newest] = (await call('/', { token })).body.items;

  assert.equal((await call(`/${newest.id}/read`, { token, method: 'POST' })).status, 204);
  assert.equal((await call(`/${newest.id}/read`, { token, method: 'POST' })).status, 204); // idempotent
  assert.deepEqual((await call('/unread-count', { token })).body, { unread: 2 });
  const unread = (await call('/?unread=true', { token })).body;
  assert.equal(unread.total, 2);
  assert.ok(!unread.items.some((i) => i.id === newest.id));
  assert.equal((await call('/', { token })).body.items[0].read, true);

  assert.deepEqual((await call('/read-all', { token, method: 'POST' })).body, { updated: 2 });
  assert.deepEqual((await call('/read-all', { token, method: 'POST' })).body, { updated: 0 });
  assert.deepEqual((await call('/unread-count', { token })).body, { unread: 0 });
});

test('HTTP: another user cannot see or mark the author\'s notifications', async (t) => {
  const w = world();
  await reviewJourney(w, crypto.randomUUID());
  await w.deliver(EVENTS.TOUR_APPROVED, { tourId: crypto.randomUUID(), contributorId: OTHER, adminId: 'a', at: at(40) });
  const call = await serve(t, w);
  const other = tokenOf(OTHER);
  const authorRow = w.repo.rows.find((r) => r.userId === AUTHOR);

  const list = (await call('/', { token: other })).body;
  assert.equal(list.total, 1);
  assert.ok(list.items.every((i) => i.id !== authorRow.id));
  const r = await call(`/${authorRow.id}/read`, { token: other, method: 'POST' });
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'notification_not_found');
  assert.deepEqual((await call('/read-all', { token: other, method: 'POST' })).body, { updated: 1 });
  assert.equal(authorRow.readAt, null);
  assert.deepEqual((await call('/unread-count', { token: tokenOf(AUTHOR) })).body, { unread: 3 });
});

test('HTTP: missing, forged, expired, subject-less and revoked tokens are refused', async (t) => {
  const w = world();
  await reviewJourney(w, crypto.randomUUID());
  const call = await serve(t, w);
  const expired = jwt.sign({ sub: AUTHOR, role: 'contributor', exp: Math.floor(Date.now() / 1000) - 60 }, SECRET);

  assert.equal((await call('/')).status, 401);
  assert.equal((await call('/', { token: tokenOf(AUTHOR, {}, 'wrong-secret') })).status, 401);
  assert.equal((await call('/', { token: expired })).status, 401);
  const noSub = await call('/unread-count', { token: jwt.sign({ role: 'contributor' }, SECRET) });
  assert.equal(noSub.status, 401);
  assert.equal(noSub.body.code, 'unauthenticated');

  // UC23: a signed-out session (sid revoked) loses access at once.
  const token = tokenOf(AUTHOR, { sid: 's1' });
  assert.equal((await call('/unread-count', { token })).status, 200);
  w.revoked.add('s1');
  assert.equal((await call('/unread-count', { token })).status, 401);
  assert.equal((await call('/read-all', { token, method: 'POST' })).status, 401);
  assert.ok(w.repo.rows.every((r) => r.readAt === null));
});
