// =========================================================
// UC16 (#270) — read side: use cases with an in-memory repository and the HTTP routes over a local
// server with a stand-in for verifyJwt (own vs other user's notification, paging, unread count,
// mark read, read-all).
// =========================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { buildContainer } from '../src/container.js';
import { ListNotifications, MarkRead, toView } from '../src/application/notification-use-cases.js';
import { MemoryNotificationRepository } from './helpers/memory-repository.js';

const silent = { log() {}, warn() {}, error() {} };
const T0 = Date.parse('2026-11-03T08:00:00Z');

// u1 gets 25 notifications (one per minute, i = 0 oldest), u2 gets 2.
async function seeded() {
  let tick = 0;
  const repo = new MemoryNotificationRepository({ clock: () => new Date(T0 + (tick++) * 60_000) });
  const { storeInApp } = buildContainer({ repository: repo, requireAuth: (_q, _s, n) => n(), logger: silent });
  for (let i = 0; i < 25; i += 1) {
    await storeInApp('tour.reported', { tourId: `t${i}`, contributorId: 'u1', tourTitle: `Tour ${i}`, count: i, reason: `Lý do ${i}` });
  }
  await storeInApp('tour.rejected', { tourId: 'x1', contributorId: 'u2', reason: 'Sai', at: '2026-11-03T09:00:00Z' });
  await storeInApp('tour.approved', { tourId: 'x2', contributorId: 'u2', adminId: 'a', at: '2026-11-03T09:00:00Z' });
  return repo;
}

test('list: own rows only, newest first, paged, unread filter, public shape', async () => {
  const repo = await seeded();
  const list = new ListNotifications({ repository: repo });
  const p1 = await list.execute({ userId: 'u1', page: 1, limit: 10 });
  assert.equal(p1.total, 25);
  assert.equal(p1.unread, 25);
  assert.equal(p1.items.length, 10);
  assert.equal(p1.items[0].title, 'Tour «Tour 24» bị khách báo cáo');
  assert.equal(p1.items[0].body, 'Lý do 24');
  assert.deepEqual(p1.items[0].data, { count: 24 });
  assert.deepEqual(Object.keys(p1.items[0]).sort(), ['body', 'createdAt', 'data', 'id', 'read', 'title', 'tourId', 'type']);
  const p3 = await list.execute({ userId: 'u1', page: 3, limit: 10 });
  assert.deepEqual(p3.items.map((i) => i.tourId), ['t4', 't3', 't2', 't1', 't0']);
  const u2 = await list.execute({ userId: 'u2' });
  assert.equal(u2.total, 2);
  assert.equal(u2.limit, 20);
  assert.ok(u2.items.every((i) => ['x1', 'x2'].includes(i.tourId)));

  await new MarkRead({ repository: repo }).execute({ userId: 'u1', id: p1.items[0].id });
  const unreadOnly = await list.execute({ userId: 'u1', unreadOnly: true, limit: 50 });
  assert.equal(unreadOnly.total, 24);
  assert.equal(unreadOnly.unread, 24);
  assert.ok(unreadOnly.items.every((i) => !i.read));
});

test('mark read: another user\'s id is 404, marking twice is fine', async () => {
  const repo = await seeded();
  const u2Row = repo.rows.find((r) => r.userId === 'u2');
  const markRead = new MarkRead({ repository: repo });
  await assert.rejects(markRead.execute({ userId: 'u1', id: u2Row.id }), (e) => e.status === 404 && e.code === 'notification_not_found');
  assert.equal(u2Row.readAt, null);
  await markRead.execute({ userId: 'u2', id: u2Row.id });
  await markRead.execute({ userId: 'u2', id: u2Row.id });
  assert.ok(toView(u2Row).read);
});

async function serve(t, repo) {
  // Stand-in for shared verifyJwt([]): "Bearer <userId>".
  const requireAuth = (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    req.user = { sub: h.slice(7), role: 'contributor' };
    return next();
  };
  const { notificationRouter } = buildContainer({ repository: repo, requireAuth, logger: silent });
  const app = express();
  app.use('/', notificationRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, { user, method = 'GET' } = {}) =>
    fetch(`${base}${path}`, { method, headers: user ? { authorization: `Bearer ${user}` } : {} });
}

test('HTTP: sign-in required, own list, paging, unread count, read, read-all', async (t) => {
  const repo = await seeded();
  const call = await serve(t, repo);

  for (const [path, method] of [['/', 'GET'], ['/unread-count', 'GET'], ['/read-all', 'POST'], [`/${repo.rows[0].id}/read`, 'POST']]) {
    assert.equal((await call(path, { method })).status, 401, path);
  }

  let res = await call('/?page=2&limit=10', { user: 'u1' });
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.page, 2);
  assert.equal(body.limit, 10);
  assert.equal(body.total, 25);
  assert.equal(body.unread, 25);
  assert.equal(body.items[0].tourId, 't14');

  assert.equal((await call('/', { user: 'u1' }).then((r) => r.json())).items.length, 20);
  for (const bad of ['?limit=0', '?limit=51', '?page=0', '?unread=yes', '?page=abc']) {
    const r = await call(`/${bad}`, { user: 'u1' });
    assert.equal(r.status, 400, bad);
    assert.equal((await r.json()).code, 'validation_error');
  }

  assert.deepEqual(await call('/unread-count', { user: 'u2' }).then((r) => r.json()), { unread: 2 });

  const u1First = body.items[0].id;
  const u2Row = repo.rows.find((r) => r.userId === 'u2');
  res = await call(`/${u2Row.id}/read`, { user: 'u1', method: 'POST' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'notification_not_found');
  assert.equal((await call('/not-a-uuid/read', { user: 'u1', method: 'POST' })).status, 404);
  assert.equal((await call('/00000000-0000-4000-8000-000000000000/read', { user: 'u1', method: 'POST' })).status, 404);
  assert.equal((await call(`/${u1First}/read`, { user: 'u1', method: 'POST' })).status, 204);
  assert.equal((await call(`/${u1First}/read`, { user: 'u1', method: 'POST' })).status, 204);
  assert.deepEqual(await call('/unread-count', { user: 'u1' }).then((r) => r.json()), { unread: 24 });

  body = await call('/?unread=true&limit=50', { user: 'u1' }).then((r) => r.json());
  assert.equal(body.total, 24);
  assert.ok(!body.items.some((i) => i.id === u1First));

  assert.deepEqual(await call('/read-all', { user: 'u1', method: 'POST' }).then((r) => r.json()), { updated: 24 });
  assert.deepEqual(await call('/read-all', { user: 'u1', method: 'POST' }).then((r) => r.json()), { updated: 0 });
  assert.deepEqual(await call('/unread-count', { user: 'u1' }).then((r) => r.json()), { unread: 0 });
  // The other user is untouched.
  assert.deepEqual(await call('/unread-count', { user: 'u2' }).then((r) => r.json()), { unread: 2 });
});
