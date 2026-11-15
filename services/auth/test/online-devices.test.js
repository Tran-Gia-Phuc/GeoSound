// =========================================================
// #265 — admin view of online devices and the session heartbeat: use cases with an in-memory
// repository (same semantics as PrismaSessionRepository.touch / countStats / listOnline) and the
// HTTP routes with a stand-in for verifyJwt(roles).
// #329 — presence of visitors who are not signed in (in-memory PresenceStore), guests counted once.
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { Session } from '../src/domain/entities/session.js';
import { SessionHeartbeat } from '../src/application/use-cases/session-heartbeat.js';
import { GetOnlineDevices, ONLINE_LIST_LIMIT } from '../src/application/use-cases/get-online-devices.js';
import { RecordPresence, LeavePresence } from '../src/application/use-cases/record-presence.js';
import { AuthController } from '../src/interfaces/http/controllers/auth-controller.js';
import { buildAuthRouter } from '../src/interfaces/http/routes/auth-routes.js';

const MIN = 60 * 1000;
const NOW = new Date('2026-11-01T10:00:00Z');
const POLICY = { onlineWindowSeconds: 120, heartbeatMinSeconds: 30 };

const USERS = {
  u1: { id: 'u1', email: 'an@mail.com', fullName: 'An', role: 'tourist' },
  u2: { id: 'u2', email: 'binh@mail.com', fullName: 'Bình', role: 'contributor' },
};

class MemorySessionRepo {
  constructor(rows) {
    this.rows = new Map(rows.map((s) => [s.id, s]));
  }
  isActive(s, now) {
    return !s.revokedAt && s.expiresAt > now;
  }
  async touch(id, now, notAfter) {
    const s = this.rows.get(id);
    if (!s || !this.isActive(s, now) || !(s.lastActiveAt < notAfter)) return false;
    s.lastActiveAt = now;
    return true;
  }
  async countStats(now, onlineSince) {
    const all = [...this.rows.values()];
    const devices = new Set(all.map((s) => (s.deviceId ? `${s.userId}|${s.deviceId}` : `row|${s.id}`)));
    const online = all.filter((s) => this.isActive(s, now) && s.lastActiveAt >= onlineSince);
    return {
      devicesSeen: devices.size,
      signedIn: all.filter((s) => this.isActive(s, now)).length,
      online: online.length,
      onlineAccounts: new Set(online.map((s) => s.userId)).size,
    };
  }
  async listOnline(now, onlineSince, limit) {
    return [...this.rows.values()]
      .filter((s) => this.isActive(s, now) && s.lastActiveAt >= onlineSince)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, limit)
      .map((session) => ({ session, user: USERS[session.userId] }));
  }
  async listOnlineDeviceIds(now, onlineSince) {
    return [...this.rows.values()]
      .filter((s) => this.isActive(s, now) && s.lastActiveAt >= onlineSince)
      .map((s) => s.deviceId);
  }
}

// Same semantics as RedisPresenceStore (tested in presence-store.test.js), without days.
class MemoryPresence {
  constructor() {
    this.seen = new Map();
    this.failing = false;
  }
  check() {
    if (this.failing) throw new Error('connect ECONNREFUSED');
  }
  async touch(deviceId, now) {
    this.check();
    this.seen.set(deviceId, now.getTime());
  }
  async leave(deviceId) {
    this.check();
    this.seen.delete(deviceId);
  }
  async countOnline(since, known) {
    this.check();
    const online = new Set([...this.seen].filter(([, t]) => t >= since.getTime()).map(([d]) => d));
    return { total: online.size, known: known.filter((d) => online.has(d)).length };
  }
  async countActive(_now, days) {
    this.check();
    return days.map(() => this.seen.size);
  }
}

const NO_PRESENCE = { onlineDevices: null, onlineGuests: null, activeToday: null, active7Days: null, active30Days: null };
const DEV = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function session(id, userId, deviceId, { lastActiveMinAgo = 0, revoked = false, expired = false } = {}) {
  return new Session({
    id,
    userId,
    deviceId,
    deviceName: `Device ${id}`,
    userAgent: 'UA',
    ipAddress: '203.0.113.9',
    location: null,
    refreshHash: `hash-${id}`,
    createdAt: new Date(NOW.getTime() - 60 * MIN),
    lastActiveAt: new Date(NOW.getTime() - lastActiveMinAgo * MIN),
    expiresAt: new Date(NOW.getTime() + (expired ? -1 : 1) * 24 * 60 * MIN),
    revokedAt: revoked ? new Date(NOW.getTime() - 5 * MIN) : null,
    revokeReason: revoked ? 'user' : null,
  });
}

// 20 devices known; 5 online (seen in the last 2 min), 3 more signed in but idle, the rest ended.
function fleet() {
  const rows = [];
  for (let i = 1; i <= 5; i += 1) rows.push(session(`on${i}`, i <= 3 ? 'u1' : 'u2', `dev-on-${i}`, { lastActiveMinAgo: 1 }));
  for (let i = 1; i <= 3; i += 1) rows.push(session(`idle${i}`, 'u2', `dev-idle-${i}`, { lastActiveMinAgo: 30 }));
  for (let i = 1; i <= 6; i += 1) rows.push(session(`gone${i}`, 'u1', `dev-gone-${i}`, { revoked: true }));
  for (let i = 1; i <= 6; i += 1) rows.push(session(`exp${i}`, 'u2', `dev-exp-${i}`, { expired: true }));
  return new MemorySessionRepo(rows);
}

test('admin view: 20 known devices, 8 signed in, 5 online on 2 accounts, online list newest first', async () => {
  const repo = fleet();
  const res = await new GetOnlineDevices({ sessionRepo: repo, policy: POLICY, now: () => NOW }).execute();
  assert.deepEqual(res.totals, { devicesSeen: 20, signedIn: 8, online: 5, onlineAccounts: 2, ...NO_PRESENCE });
  assert.equal(res.onlineWindowSeconds, 120);
  assert.equal(res.at, NOW.toISOString());
  assert.equal(res.online.length, 5);
  assert.deepEqual(Object.keys(res.online[0]).sort(), ['createdAt', 'deviceName', 'id', 'lastActiveAt', 'location', 'user']);
  assert.deepEqual(res.online.find((d) => d.id === 'on4').user, USERS.u2);
  // Never the IP, user agent or refresh hash.
  assert.doesNotMatch(JSON.stringify(res), /203\.0\.113|hash-|"UA"/);
});

test('online list is capped', async () => {
  const rows = Array.from({ length: ONLINE_LIST_LIMIT + 5 }, (_, i) => session(`s${i}`, 'u1', `d${i}`));
  const res = await new GetOnlineDevices({ sessionRepo: new MemorySessionRepo(rows), policy: POLICY, now: () => NOW }).execute();
  assert.equal(res.online.length, ONLINE_LIST_LIMIT);
  assert.equal(res.totals.online, ONLINE_LIST_LIMIT + 5);
});

test('heartbeat: moves lastActiveAt, throttled, ignored for ended sessions and tokens without sid', async () => {
  const repo = fleet();
  const beat = (sid, at) => new SessionHeartbeat({ sessionRepo: repo, policy: POLICY, now: () => at }).execute({ currentSid: sid });

  assert.deepEqual(await beat('idle1', NOW), { touched: true });
  assert.equal(repo.rows.get('idle1').lastActiveAt.getTime(), NOW.getTime());
  // A second beat 10 s later is skipped (heartbeatMinSeconds = 30), one 40 s later is written.
  assert.deepEqual(await beat('idle1', new Date(NOW.getTime() + 10_000)), { touched: false });
  assert.deepEqual(await beat('idle1', new Date(NOW.getTime() + 40_000)), { touched: true });

  assert.deepEqual(await beat('gone1', NOW), { touched: false });
  assert.deepEqual(await beat('exp1', NOW), { touched: false });
  assert.deepEqual(await beat(null, NOW), { touched: false });

  // The idle device now counts as online.
  const res = await new GetOnlineDevices({ sessionRepo: repo, policy: POLICY, now: () => new Date(NOW.getTime() + 40_000) }).execute();
  assert.ok(res.online.some((d) => d.id === 'idle1'));
});

test('HTTP: heartbeat for any signed-in device, admin view for role admin only', async () => {
  const repo = fleet();
  const useCases = {
    sessionHeartbeat: new SessionHeartbeat({ sessionRepo: repo, policy: POLICY, now: () => NOW }),
    getOnlineDevices: new GetOnlineDevices({ sessionRepo: repo, policy: POLICY, now: () => NOW }),
  };
  // Stand-in for shared verifyJwt(roles): "Bearer <userId>:<sid>:<role>".
  const guard = (roles = []) => (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const [sub, sid, role] = h.slice(7).split(':');
    if (roles.length && !roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    req.user = { sub, sid, role };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/', buildAuthRouter({ authController: new AuthController(useCases), requireAuth: guard(), requireAdmin: guard(['admin']) }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bearer = (v) => ({ authorization: `Bearer ${v}` });
    assert.equal((await fetch(`${base}/sessions/heartbeat`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/sessions/heartbeat`, { method: 'POST', headers: bearer('u2:idle2:tourist') })).status, 204);
    assert.equal(repo.rows.get('idle2').lastActiveAt.getTime(), NOW.getTime());

    assert.equal((await fetch(`${base}/admin/sessions`)).status, 401);
    assert.equal((await fetch(`${base}/admin/sessions`, { headers: bearer('u1:on1:tourist') })).status, 403);
    const ok = await fetch(`${base}/admin/sessions`, { headers: bearer('a1:x:admin') });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual(body.totals, { devicesSeen: 20, signedIn: 8, online: 6, onlineAccounts: 2, ...NO_PRESENCE });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('presence: guests count, a signed-in device counts once, old clients without device id too', async () => {
  const repo = fleet(); // online sessions on devices dev-on-1..5
  const presence = new MemoryPresence();
  const record = new RecordPresence({ presence, now: () => NOW });
  for (const d of ['dev-on-1', 'dev-on-2', 'guest-1', 'guest-2', 'guest-3']) await record.execute({ deviceId: d });
  await presence.touch('guest-gone', new Date(NOW.getTime() - 3 * MIN)); // last beat 3 min ago
  repo.rows.get('on5').deviceId = null; // signed in from an old client: no device id

  const res = await new GetOnlineDevices({ sessionRepo: repo, presence, policy: POLICY, now: () => NOW }).execute();
  // 5 signed-in devices (dev-on-3/4 have a session but sent no beat yet, on5 has no device id) + 3 guests.
  assert.equal(res.totals.online, 5);
  assert.equal(res.totals.onlineGuests, 3);
  assert.equal(res.totals.onlineDevices, 8);
  assert.equal(res.totals.activeToday, 6);
  assert.equal(res.online.length, 5); // the list stays signed-in devices only

  // The guest closes the page: out at once.
  assert.deepEqual(await new LeavePresence({ presence }).execute({ deviceId: 'guest-1' }), { left: true });
  const after = await new GetOnlineDevices({ sessionRepo: repo, presence, policy: POLICY, now: () => NOW }).execute();
  assert.equal(after.totals.onlineGuests, 2);
});

test('presence: a beat with a session also touches it; Redis down never fails the beat or the admin view', async () => {
  const repo = fleet();
  const presence = new MemoryPresence();
  const warnings = [];
  const logger = { warn: (m) => warnings.push(m) };
  const sessionHeartbeat = new SessionHeartbeat({ sessionRepo: repo, policy: POLICY, now: () => NOW });
  const record = new RecordPresence({ presence, sessionHeartbeat, now: () => NOW, logger });

  assert.deepEqual(await record.execute({ deviceId: 'dev-idle-1', currentSid: 'idle1' }), { recorded: true, touched: true });
  assert.equal(repo.rows.get('idle1').lastActiveAt.getTime(), NOW.getTime());

  presence.failing = true;
  assert.deepEqual(await record.execute({ deviceId: 'g1' }), { recorded: false, touched: false });
  assert.deepEqual(await record.execute({ deviceId: 'g2' }), { recorded: false, touched: false });
  assert.equal(warnings.length, 1); // once per outage
  assert.deepEqual(await new LeavePresence({ presence }).execute({ deviceId: 'g1' }), { left: false });

  const res = await new GetOnlineDevices({ sessionRepo: repo, presence, policy: POLICY, now: () => NOW }).execute();
  assert.deepEqual(res.totals, { devicesSeen: 20, signedIn: 8, online: 6, onlineAccounts: 2, ...NO_PRESENCE });
});

test('HTTP: presence without sign-in, with a valid token (session touched), bad token 401, leave by beacon', async () => {
  const repo = fleet();
  const presence = new MemoryPresence();
  const sessionHeartbeat = new SessionHeartbeat({ sessionRepo: repo, policy: POLICY, now: () => NOW });
  const useCases = {
    sessionHeartbeat,
    recordPresence: new RecordPresence({ presence, sessionHeartbeat, now: () => NOW }),
    leavePresence: new LeavePresence({ presence }),
    getOnlineDevices: new GetOnlineDevices({ sessionRepo: repo, presence, policy: POLICY, now: () => NOW }),
  };
  const guard = (roles = []) => (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const [sub, sid, role] = h.slice(7).split(':');
    if (sub === 'bad') return res.status(401).json({ error: 'Invalid token' });
    if (roles.length && !roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    req.user = { sub, sid, role };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/', buildAuthRouter({ authController: new AuthController(useCases), requireAuth: guard(), requireAdmin: guard(['admin']) }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/presence', { deviceId: DEV(1) })).status, 204);
    assert.ok(presence.seen.has(DEV(1)));

    assert.equal((await post('/presence', { deviceId: 'not-a-uuid' })).status, 400);
    assert.equal((await post('/presence', {})).status, 400);

    assert.equal((await post('/presence', { deviceId: DEV(2) }, { authorization: 'Bearer bad' })).status, 401);
    assert.ok(!presence.seen.has(DEV(2)));

    assert.equal((await post('/presence', { deviceId: DEV(3) }, { authorization: 'Bearer u2:idle3:tourist' })).status, 204);
    assert.equal(repo.rows.get('idle3').lastActiveAt.getTime(), NOW.getTime());

    // sendBeacon body: JSON sent as text/plain.
    const leave = await fetch(`${base}/presence/leave`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ deviceId: DEV(1) }),
    });
    assert.equal(leave.status, 204);
    assert.ok(!presence.seen.has(DEV(1)));
    const garbage = await fetch(`${base}/presence/leave`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    assert.equal(garbage.status, 400);

    const res = await fetch(`${base}/admin/sessions`, { headers: { authorization: 'Bearer a1:x:admin' } });
    const { totals } = await res.json();
    // 6 online sessions (idle3 touched) on 6 device ids; DEV(3) beat with idle3's token but is not
    // idle3's device id (dev-idle-3), so it counts as one more device.
    assert.equal(totals.online, 6);
    assert.equal(totals.onlineGuests, 1);
    assert.equal(totals.onlineDevices, 7);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
