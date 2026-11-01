// =========================================================
// #265 — admin view of online devices and the session heartbeat: use cases with an in-memory
// repository (same semantics as PrismaSessionRepository.touch / countStats / listOnline) and the
// HTTP routes with a stand-in for verifyJwt(roles).
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { Session } from '../src/domain/entities/session.js';
import { SessionHeartbeat } from '../src/application/use-cases/session-heartbeat.js';
import { GetOnlineDevices, ONLINE_LIST_LIMIT } from '../src/application/use-cases/get-online-devices.js';
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
}

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
  assert.deepEqual(res.totals, { devicesSeen: 20, signedIn: 8, online: 5, onlineAccounts: 2 });
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
    assert.deepEqual(body.totals, { devicesSeen: 20, signedIn: 8, online: 6, onlineAccounts: 2 });
  } finally {
    await new Promise((r) => server.close(r));
  }
});
