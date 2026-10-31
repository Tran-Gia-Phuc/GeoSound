// =========================================================
// UC23 — signed-in device sessions: use cases with in-memory fakes (no DB, Redis, broker),
// plus the HTTP routes, the JWT token service and the Redis revocation store with fakes.
// Spec: docs/02-design/device-sessions.md sections 4 and 5.
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';

import { User } from '../src/domain/entities/user.js';
import { Session } from '../src/domain/entities/session.js';
import { deviceNameFromUserAgent, UNKNOWN_DEVICE } from '../src/domain/value-objects/device-name.js';
import { SessionManager, NEW_DEVICE_LOGIN_EVENT } from '../src/application/services/session-manager.js';
import { Login } from '../src/application/use-cases/login.js';
import { RefreshToken } from '../src/application/use-cases/refresh-token.js';
import { ResetPassword } from '../src/application/use-cases/reset-password.js';
import { ListSessions } from '../src/application/use-cases/list-sessions.js';
import { RevokeSession } from '../src/application/use-cases/revoke-session.js';
import { RevokeOtherSessions } from '../src/application/use-cases/revoke-other-sessions.js';
import { Logout } from '../src/application/use-cases/logout.js';
import { RevokeAllSessions } from '../src/application/use-cases/revoke-all-sessions.js';
import { ChangePassword } from '../src/application/use-cases/change-password.js';
import { PurgeEndedSessions } from '../src/application/use-cases/purge-ended-sessions.js';
import { loginSchema, refreshSchema } from '../src/application/dtos/schemas.js';
import { JwtTokenService } from '../src/infrastructure/security/jwt-token-service.js';
import { durationToSeconds } from '../src/infrastructure/security/duration.js';
import { RedisRevocationStore } from '../src/infrastructure/cache/redis-revocation-store.js';
import { AuthController } from '../src/interfaces/http/controllers/auth-controller.js';
import { buildAuthRouter } from '../src/interfaces/http/routes/auth-routes.js';
import { clientIp } from '../src/interfaces/http/request-context.js';
import { sessionPolicy } from '../src/config.js';

const DAY = 24 * 60 * 60 * 1000;
const UA_CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const UA_SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0';

// ---------- Fakes ----------
class FakeUserRepo {
  constructor(users = []) {
    this.rows = new Map(users.map((u) => [u.id, u]));
  }
  async findByEmail(email) {
    return [...this.rows.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id) {
    return this.rows.get(id) ?? null;
  }
  async save(user) {
    this.rows.set(user.id, user);
    return user;
  }
}

class FakeSessionRepo {
  constructor() {
    this.rows = new Map();
  }
  async create(s) {
    this.rows.set(s.id, s);
    return s;
  }
  async save(s) {
    this.rows.set(s.id, s);
    return s;
  }
  async findById(id) {
    return this.rows.get(id) ?? null;
  }
  async findLatestByDevice(userId, deviceId) {
    return (
      [...this.rows.values()]
        .filter((s) => s.userId === userId && s.deviceId === deviceId)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  }
  async listActiveByUser(userId, now) {
    return [...this.rows.values()].filter((s) => s.userId === userId && s.isActive(now));
  }
  async deleteEndedBefore(cutoff) {
    let n = 0;
    for (const [id, s] of this.rows) {
      if ((s.revokedAt && s.revokedAt < cutoff) || s.expiresAt < cutoff) {
        this.rows.delete(id);
        n += 1;
      }
    }
    return n;
  }
}

class FakeRevocations {
  constructor() {
    this.marked = [];
    this.fail = false;
  }
  async markRevoked(sid) {
    if (this.fail) throw new Error('redis down');
    this.marked.push(sid);
  }
}

class FakePublisher {
  constructor() {
    this.events = [];
    this.fail = false;
  }
  async publish(name, payload) {
    if (this.fail) throw new Error('broker down');
    this.events.push({ name, payload });
  }
}

// Tokens are readable strings; each refresh token is unique (like the real jti).
function makeFakeTokens() {
  let n = 0;
  return {
    issueTokens: (u, { sid } = {}) => {
      n += 1;
      return {
        accessToken: sid ? `at:${u.id}:${sid}:${n}` : `at:${u.id}`,
        refreshToken: sid ? `rt:${u.id}:${sid}:${n}` : `rt:${u.id}`,
        expiresIn: '15m',
      };
    },
    verifyRefresh: (t) => {
      const [kind, sub, sid] = String(t).split(':');
      if (kind !== 'rt') throw new Error('bad token');
      return sid ? { sub, sid } : { sub };
    },
    hashRefresh: (t) => `hash(${t})`,
  };
}

const fakeHasher = {
  async hash(p) {
    return `h:${p}`;
  },
  async compare(p, h) {
    return h === `h:${p}`;
  },
};

const silent = { log() {}, warn() {}, error() {} };

function makeKit({ maxSessions = 100, idleDays = 7, maxDays = 30, start = Date.parse('2026-10-30T08:00:00Z') } = {}) {
  const clock = { t: start };
  const now = () => new Date(clock.t);
  const user = new User({ id: 'u1', email: 'an@mail.com', passwordHash: 'h:abc12345', fullName: 'An' });
  const other = new User({ id: 'u2', email: 'binh@mail.com', passwordHash: 'h:abc12345', fullName: 'Bình' });
  const userRepo = new FakeUserRepo([user, other]);
  const sessionRepo = new FakeSessionRepo();
  const revocations = new FakeRevocations();
  const publisher = new FakePublisher();
  const tokens = makeFakeTokens();
  const policy = { idleDays, maxDays, maxSessions };
  let seq = 0;
  const sessions = new SessionManager({
    sessionRepo,
    tokens,
    revocations,
    publisher,
    policy,
    now,
    newId: () => `s${++seq}`,
    logger: silent,
  });
  const login = new Login({ userRepo, hasher: fakeHasher, tokens, policy: { maxAttempts: 5, lockMs: 60000 }, sessions, now });
  const refresh = new RefreshToken({ userRepo, tokens, sessions, sessionRepo, policy, now });
  const signIn = (deviceId, userAgent = UA_CHROME_WIN, email = 'an@mail.com') =>
    login.execute({ email, password: 'abc12345', deviceId, userAgent, ip: '203.0.113.7' });
  const advance = (ms) => {
    clock.t += ms;
  };
  return { clock, now, advance, user, userRepo, sessionRepo, revocations, publisher, tokens, sessions, login, refresh, signIn, policy };
}

const sidOf = (res) => res.accessToken.split(':')[2];

// ---------- Device name (R2) ----------
test('device name: browser + OS from the User-Agent, with a fallback', () => {
  assert.equal(deviceNameFromUserAgent(UA_CHROME_WIN), 'Chrome trên Windows');
  assert.equal(deviceNameFromUserAgent(UA_SAFARI_IPHONE), 'Safari trên iPhone');
  assert.equal(deviceNameFromUserAgent(UA_FIREFOX_MAC), 'Firefox trên macOS');
  assert.equal(
    deviceNameFromUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0'),
    'Edge trên Windows',
  );
  assert.equal(
    deviceNameFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'),
    'Chrome trên Android',
  );
  assert.equal(deviceNameFromUserAgent(''), UNKNOWN_DEVICE);
  assert.equal(deviceNameFromUserAgent(undefined), UNKNOWN_DEVICE);
  assert.equal(deviceNameFromUserAgent('curl/8.0'), UNKNOWN_DEVICE);
});

// ---------- Login (R1, R9, R10) ----------
test('three logins with three deviceIds list three sessions; a known deviceId replaces its session', async () => {
  const k = makeKit();
  await k.signIn('device-aaaa', UA_CHROME_WIN);
  await k.signIn('device-bbbb', UA_SAFARI_IPHONE);
  const third = await k.signIn('device-cccc', UA_FIREFOX_MAC);

  let list = await new ListSessions({ sessionRepo: k.sessionRepo, now: k.now }).execute({ userId: 'u1', currentSid: sidOf(third) });
  assert.equal(list.sessions.length, 3);
  assert.equal(list.sessions.filter((s) => s.current).length, 1);
  assert.equal(list.sessions[0].id, sidOf(third));

  k.advance(1000);
  const again = await k.signIn('device-aaaa', UA_CHROME_WIN);
  list = await new ListSessions({ sessionRepo: k.sessionRepo, now: k.now }).execute({ userId: 'u1', currentSid: sidOf(again) });
  assert.equal(list.sessions.length, 3, 'same device replaces, does not add');
  const old = k.sessionRepo.rows.get('s1');
  assert.equal(old.revokeReason, 'user');
  assert.ok(k.revocations.marked.includes('s1'), 'replaced session sid is marked revoked');
});

test('login: tokens carry the sid, the session stores the refresh hash, device data and expiry', async () => {
  const k = makeKit();
  const res = await k.signIn('device-aaaa');
  const s = k.sessionRepo.rows.get(sidOf(res));
  assert.ok(s);
  assert.equal(s.refreshHash, `hash(${res.refreshToken})`);
  assert.equal(s.deviceName, 'Chrome trên Windows');
  assert.equal(s.ipAddress, '203.0.113.7');
  assert.equal(s.location, null);
  assert.equal(s.expiresAt.getTime(), k.clock.t + 7 * DAY);
  assert.equal(res.user.email, 'an@mail.com');
});

test('new-device alert: sent for a new deviceId or none, not for a known device, failure only logged', async () => {
  const k = makeKit();
  await k.signIn('device-aaaa');
  assert.equal(k.publisher.events.length, 1);
  const ev = k.publisher.events[0];
  assert.equal(ev.name, NEW_DEVICE_LOGIN_EVENT);
  assert.equal(ev.name, 'auth.new_device_login');
  assert.deepEqual(Object.keys(ev.payload).sort(), ['at', 'deviceName', 'email', 'userId']);
  assert.equal(ev.payload.email, 'an@mail.com');
  assert.match(ev.payload.at, /Z$/);

  await k.signIn('device-aaaa'); // same device again -> no alert
  assert.equal(k.publisher.events.length, 1);

  await k.signIn(undefined); // no deviceId -> treated as new
  assert.equal(k.publisher.events.length, 2);

  k.publisher.fail = true;
  const res = await k.signIn('device-zzzz');
  assert.ok(res.accessToken, 'sign-in succeeds when the broker is down');
});

test('a device that signed out and signs in again is not a new device', async () => {
  const k = makeKit();
  const first = await k.signIn('device-aaaa');
  await new Logout({ sessionRepo: k.sessionRepo, sessions: k.sessions }).execute({ userId: 'u1', currentSid: sidOf(first) });
  await k.signIn('device-aaaa');
  assert.equal(k.publisher.events.length, 1);
});

test('cap (R9): past AUTH_MAX_SESSIONS the least recently active session is signed out', async () => {
  const k = makeKit({ maxSessions: 2 });
  await k.signIn('device-aaaa');
  k.advance(1000);
  const b = await k.signIn('device-bbbb');
  k.advance(1000);
  // device-aaaa becomes the most recently active one through a refresh.
  const aSession = k.sessionRepo.rows.get('s1');
  const aRefresh = `rt:u1:s1:${1}`;
  assert.equal(aSession.refreshHash, `hash(${aRefresh})`);
  await k.refresh.execute({ refreshToken: aRefresh });
  k.advance(1000);
  await k.signIn('device-cccc');

  const active = await k.sessionRepo.listActiveByUser('u1', k.now());
  assert.equal(active.length, 2);
  const bSession = k.sessionRepo.rows.get(sidOf(b));
  assert.equal(bSession.revokeReason, 'limit');
  assert.ok(k.revocations.marked.includes(bSession.id));
});

test('login without a SessionManager keeps the old behaviour (no sid)', async () => {
  const k = makeKit();
  const legacy = new Login({ userRepo: k.userRepo, hasher: fakeHasher, tokens: k.tokens, policy: { maxAttempts: 5, lockMs: 60000 } });
  const res = await legacy.execute({ email: 'an@mail.com', password: 'abc12345' });
  assert.equal(res.accessToken, 'at:u1');
  assert.equal(k.sessionRepo.rows.size, 0);
});

// ---------- Refresh (R8, R11, rollout) ----------
test('refresh rotates the refresh token and moves the activity time', async () => {
  const k = makeKit();
  const res = await k.signIn('device-aaaa');
  k.advance(2 * DAY);
  const next = await k.refresh.execute({ refreshToken: res.refreshToken, ip: '198.51.100.9' });
  assert.notEqual(next.refreshToken, res.refreshToken);
  assert.equal(sidOf(next), sidOf(res), 'same session');
  const s = k.sessionRepo.rows.get(sidOf(res));
  assert.equal(s.refreshHash, `hash(${next.refreshToken})`);
  assert.equal(s.lastActiveAt.getTime(), k.clock.t);
  assert.equal(s.ipAddress, '198.51.100.9');
  assert.equal(s.expiresAt.getTime(), k.clock.t + 7 * DAY);
});

test('reuse (R11): an old refresh token signs the session out; the new one then fails too', async () => {
  const k = makeKit();
  const res = await k.signIn('device-aaaa');
  const next = await k.refresh.execute({ refreshToken: res.refreshToken });
  await assert.rejects(() => k.refresh.execute({ refreshToken: res.refreshToken }), (e) => e.status === 401 && e.code === 'session_revoked');
  const s = k.sessionRepo.rows.get(sidOf(res));
  assert.equal(s.revokeReason, 'reuse');
  assert.ok(k.revocations.marked.includes(s.id));
  await assert.rejects(() => k.refresh.execute({ refreshToken: next.refreshToken }), (e) => e.code === 'session_revoked');
});

test('expiry (R8): 7 days idle ends a session; 30 days after sign-in ends it even when active', async () => {
  const k = makeKit();
  const res = await k.signIn('device-aaaa');
  k.advance(7 * DAY + 1);
  await assert.rejects(() => k.refresh.execute({ refreshToken: res.refreshToken }), (e) => e.code === 'session_revoked');
  assert.equal(k.sessionRepo.rows.get(sidOf(res)).revokeReason, 'expired');

  const k2 = makeKit();
  let cur = await k2.signIn('device-bbbb');
  for (const days of [6, 6, 6, 6, 5]) {
    k2.advance(days * DAY);
    cur = await k2.refresh.execute({ refreshToken: cur.refreshToken }); // active up to day 29
  }
  const s = k2.sessionRepo.rows.get(sidOf(cur));
  assert.equal(s.expiresAt.getTime(), s.createdAt.getTime() + 30 * DAY, 'capped by the absolute limit');
  k2.advance(DAY);
  await assert.rejects(() => k2.refresh.execute({ refreshToken: cur.refreshToken }), (e) => e.code === 'session_revoked');
});

test('refresh of a revoked session, an unknown sid or a sid of another user is rejected', async () => {
  const k = makeKit();
  const res = await k.signIn('device-aaaa');
  await new Logout({ sessionRepo: k.sessionRepo, sessions: k.sessions }).execute({ userId: 'u1', currentSid: sidOf(res) });
  await assert.rejects(() => k.refresh.execute({ refreshToken: res.refreshToken }), (e) => e.code === 'session_revoked');
  await assert.rejects(() => k.refresh.execute({ refreshToken: 'rt:u1:nope:1' }), (e) => e.code === 'session_revoked');
  const bin = await k.signIn('device-bbbb', UA_CHROME_WIN, 'binh@mail.com');
  await assert.rejects(() => k.refresh.execute({ refreshToken: `rt:u1:${sidOf(bin)}:9` }), (e) => e.code === 'session_revoked');
  await assert.rejects(() => k.refresh.execute({ refreshToken: 'garbage' }), (e) => e.code === 'invalid_token');
});

test('legacy refresh token without sid gets a session (no alert) and works from then on', async () => {
  const k = makeKit();
  const res = await k.refresh.execute({ refreshToken: 'rt:u1', deviceId: 'device-old1', userAgent: UA_SAFARI_IPHONE });
  const sid = sidOf(res);
  assert.ok(sid, 'new tokens carry a sid');
  const s = k.sessionRepo.rows.get(sid);
  assert.equal(s.deviceName, 'Safari trên iPhone');
  assert.equal(k.publisher.events.length, 0, 'no new-device email for an existing login');
  const next = await k.refresh.execute({ refreshToken: res.refreshToken });
  assert.equal(sidOf(next), sid);
});

test('refresh of a banned user is refused', async () => {
  const k = makeKit();
  const res = await k.signIn('device-aaaa');
  k.user.status = 'banned';
  await assert.rejects(() => k.refresh.execute({ refreshToken: res.refreshToken }), (e) => e.status === 403);
});

// ---------- Device list and sign-outs (R3, R4, R5, R6) ----------
test('list: active only, current first, then last activity newest first, no IP or hash', async () => {
  const k = makeKit();
  const a = await k.signIn('device-aaaa');
  k.advance(1000);
  await k.signIn('device-bbbb');
  k.advance(1000);
  const c = await k.signIn('device-cccc');
  k.advance(1000);
  await k.refresh.execute({ refreshToken: a.refreshToken }); // a is now the most recent
  await new RevokeSession({ sessionRepo: k.sessionRepo, sessions: k.sessions, now: k.now }).execute({
    userId: 'u1',
    currentSid: sidOf(c),
    sessionId: 's2',
  });

  const { sessions } = await new ListSessions({ sessionRepo: k.sessionRepo, now: k.now }).execute({ userId: 'u1', currentSid: sidOf(c) });
  assert.deepEqual(sessions.map((s) => s.id), [sidOf(c), sidOf(a)]);
  assert.deepEqual(sessions.map((s) => s.current), [true, false]);
  assert.deepEqual(Object.keys(sessions[0]).sort(), ['createdAt', 'current', 'deviceName', 'id', 'lastActiveAt', 'location']);
});

test('delete one device: own -> revoked; other user or unknown -> 404; current -> 409', async () => {
  const k = makeKit();
  const a = await k.signIn('device-aaaa');
  const b = await k.signIn('device-bbbb');
  const bin = await k.signIn('device-cccc', UA_CHROME_WIN, 'binh@mail.com');
  const uc = new RevokeSession({ sessionRepo: k.sessionRepo, sessions: k.sessions, now: k.now });

  await assert.rejects(() => uc.execute({ userId: 'u1', currentSid: sidOf(b), sessionId: sidOf(b) }), (e) => e.status === 409);
  await assert.rejects(() => uc.execute({ userId: 'u1', currentSid: sidOf(b), sessionId: sidOf(bin) }), (e) => e.status === 404);
  await assert.rejects(() => uc.execute({ userId: 'u1', currentSid: sidOf(b), sessionId: 'unknown' }), (e) => e.status === 404);
  assert.equal(k.sessionRepo.rows.get(sidOf(bin)).revokedAt, null);

  await uc.execute({ userId: 'u1', currentSid: sidOf(b), sessionId: sidOf(a) });
  assert.equal(k.sessionRepo.rows.get(sidOf(a)).revokeReason, 'user');
  assert.ok(k.revocations.marked.includes(sidOf(a)));
  await assert.rejects(() => uc.execute({ userId: 'u1', currentSid: sidOf(b), sessionId: sidOf(a) }), (e) => e.status === 404, 'already ended');
});

test('revoke others: every other session ends, the current one stays', async () => {
  const k = makeKit();
  await k.signIn('device-aaaa');
  await k.signIn('device-bbbb');
  const c = await k.signIn('device-cccc');
  const bin = await k.signIn('device-dddd', UA_CHROME_WIN, 'binh@mail.com');
  const res = await new RevokeOtherSessions({ sessions: k.sessions }).execute({ userId: 'u1', currentSid: sidOf(c) });
  assert.deepEqual(res, { revoked: 2 });
  const active = await k.sessionRepo.listActiveByUser('u1', k.now());
  assert.deepEqual(active.map((s) => s.id), [sidOf(c)]);
  assert.equal(k.sessionRepo.rows.get('s1').revokeReason, 'user_all');
  assert.equal(k.sessionRepo.rows.get(sidOf(bin)).revokedAt, null, 'other users untouched');
});

test('logout ends the current session; a token without sid is a no-op', async () => {
  const k = makeKit();
  const a = await k.signIn('device-aaaa');
  const uc = new Logout({ sessionRepo: k.sessionRepo, sessions: k.sessions });
  assert.deepEqual(await uc.execute({ userId: 'u1', currentSid: sidOf(a) }), { revoked: true });
  assert.equal(k.sessionRepo.rows.get(sidOf(a)).revokeReason, 'user');
  assert.deepEqual(k.revocations.marked, [sidOf(a)]);
  assert.deepEqual(await uc.execute({ userId: 'u1', currentSid: null }), { revoked: false });
  assert.deepEqual(await uc.execute({ userId: 'u2', currentSid: sidOf(a) }), { revoked: false });
});

test('a revoke still succeeds when the revocation store is down (logged only)', async () => {
  const k = makeKit();
  const a = await k.signIn('device-aaaa');
  k.revocations.fail = true;
  await new Logout({ sessionRepo: k.sessionRepo, sessions: k.sessions }).execute({ userId: 'u1', currentSid: sidOf(a) });
  assert.ok(k.sessionRepo.rows.get(sidOf(a)).revokedAt);
});

// ---------- Automatic sign-out (R7, R13) ----------
test('password reset signs out every device of the account', async () => {
  const k = makeKit();
  await k.signIn('device-aaaa');
  await k.signIn('device-bbbb');
  const challenges = {
    map: new Map([['reset:an@mail.com', { code: '123456' }]]),
    async get(kind, email) {
      return this.map.get(`${kind}:${email}`) ?? null;
    },
    async delete(kind, email) {
      this.map.delete(`${kind}:${email}`);
    },
  };
  const reset = new ResetPassword({ userRepo: k.userRepo, hasher: fakeHasher, challenges, sessions: k.sessions });
  await reset.execute({ email: 'an@mail.com', otp: '123456', newPassword: 'new12345' });
  assert.equal((await k.sessionRepo.listActiveByUser('u1', k.now())).length, 0);
  assert.ok([...k.sessionRepo.rows.values()].every((s) => s.revokeReason === 'password_reset'));
  assert.deepEqual(k.revocations.marked.sort(), ['s1', 's2']);
});

test('RevokeAllSessions (for UC21 ban) ends every session with reason banned', async () => {
  const k = makeKit();
  await k.signIn('device-aaaa');
  await k.signIn('device-bbbb');
  const res = await new RevokeAllSessions({ sessions: k.sessions }).execute({ userId: 'u1' });
  assert.deepEqual(res, { revoked: 2 });
  assert.ok([...k.sessionRepo.rows.values()].every((s) => s.revokeReason === 'banned'));
});

// ---------- Retention (R12) ----------
test('purge deletes sessions ended more than 30 days ago and keeps the rest', async () => {
  const k = makeKit();
  const a = await k.signIn('device-aaaa'); // revoked now, 31 days old at purge time
  await new Logout({ sessionRepo: k.sessionRepo, sessions: k.sessions }).execute({ userId: 'u1', currentSid: sidOf(a) });
  await k.signIn('device-bbbb'); // expires (idle) at day 7 -> ended 24 days before purge: kept
  k.advance(25 * DAY);
  const c = await k.signIn('device-cccc'); // active
  k.advance(6 * DAY);
  const purge = new PurgeEndedSessions({ sessionRepo: k.sessionRepo, retentionDays: 30, now: k.now });
  const { deleted } = await purge.execute();
  assert.equal(deleted, 1);
  assert.equal(k.sessionRepo.rows.has(sidOf(a)), false);
  assert.equal(k.sessionRepo.rows.has('s2'), true);
  assert.equal(k.sessionRepo.rows.has(sidOf(c)), true);
});

// ---------- Validation, config, infrastructure ----------
test('deviceId is optional and 8..100 characters on login and refresh', () => {
  const base = { email: 'a@mail.com', password: 'x' };
  assert.equal(loginSchema.safeParse(base).success, true);
  assert.equal(loginSchema.safeParse({ ...base, deviceId: 'abcdefgh' }).success, true);
  assert.equal(loginSchema.safeParse({ ...base, deviceId: 'short' }).success, false);
  assert.equal(loginSchema.safeParse({ ...base, deviceId: 'x'.repeat(101) }).success, false);
  assert.equal(refreshSchema.safeParse({ refreshToken: 't', deviceId: 'abcdefgh' }).success, true);
});

test('session policy defaults and env overrides', () => {
  assert.deepEqual(sessionPolicy({}), { idleDays: 7, maxDays: 30, maxSessions: 100, retentionDays: 30 });
  assert.deepEqual(
    sessionPolicy({ AUTH_SESSION_IDLE_DAYS: '3', AUTH_SESSION_MAX_DAYS: '10', AUTH_MAX_SESSIONS: '5', AUTH_SESSION_RETENTION_DAYS: '1' }),
    { idleDays: 3, maxDays: 10, maxSessions: 5, retentionDays: 1 },
  );
  assert.equal(sessionPolicy({ AUTH_MAX_SESSIONS: 'abc' }).maxSessions, 100);
});

test('JwtTokenService: sid in access and refresh tokens, random jti, sha-256 hash, legacy tokens', () => {
  const svc = new JwtTokenService({ accessSecret: 'a-secret', refreshSecret: 'r-secret', accessTtl: '15m', refreshTtl: '7d' });
  const user = new User({ id: 'u1', email: 'an@mail.com', passwordHash: 'x', fullName: 'An', role: 'tourist' });
  const t1 = svc.issueTokens(user, { sid: 's1' });
  const t2 = svc.issueTokens(user, { sid: 's1' });
  const access = jwt.verify(t1.accessToken, 'a-secret');
  assert.equal(access.sid, 's1');
  assert.equal(access.role, 'tourist');
  const refresh = jwt.verify(t1.refreshToken, 'r-secret');
  assert.equal(refresh.sid, 's1');
  assert.ok(refresh.jti);
  assert.notEqual(t1.refreshToken, t2.refreshToken);
  assert.deepEqual(svc.verifyRefresh(t1.refreshToken), { sub: 'u1', sid: 's1' });
  assert.match(svc.hashRefresh(t1.refreshToken), /^[0-9a-f]{64}$/);
  assert.notEqual(svc.hashRefresh(t1.refreshToken), svc.hashRefresh(t2.refreshToken));

  const legacy = svc.issueTokens(user);
  assert.equal(jwt.verify(legacy.accessToken, 'a-secret').sid, undefined);
  assert.deepEqual(svc.verifyRefresh(legacy.refreshToken), { sub: 'u1' });
});

test('revocation key revoked:sid:<sid> is written with TTL = access token lifetime', async () => {
  const calls = [];
  const redis = { set: async (...args) => calls.push(args) };
  const store = new RedisRevocationStore(redis, { ttlSeconds: durationToSeconds('15m') });
  await store.markRevoked('s1');
  assert.deepEqual(calls, [['revoked:sid:s1', '1', 'EX', 900]]);
});

test('revocation write gives up after its timeout when Redis hangs', async () => {
  const redis = { set: () => new Promise(() => {}) }; // offline queue never answers
  const store = new RedisRevocationStore(redis, { ttlSeconds: 900, timeoutMs: 20 });
  await assert.rejects(store.markRevoked('s1'), /timed out/);
});

test('durationToSeconds parses jsonwebtoken lifetimes', () => {
  assert.equal(durationToSeconds('15m'), 900);
  assert.equal(durationToSeconds('1h'), 3600);
  assert.equal(durationToSeconds('7d'), 604800);
  assert.equal(durationToSeconds('30s'), 30);
  assert.equal(durationToSeconds('5000'), 5, 'bare string = milliseconds like jsonwebtoken');
  assert.equal(durationToSeconds(120), 120);
  assert.equal(durationToSeconds('nonsense'), 900);
});

test('Session entity: expiry is the earlier of idle and absolute limits', () => {
  const now = new Date('2026-10-30T00:00:00Z');
  const s = Session.start({ id: 's', userId: 'u', deviceName: 'x', refreshHash: 'h' }, { idleDays: 7, maxDays: 30 }, now);
  assert.equal(s.expiresAt.getTime(), now.getTime() + 7 * DAY);
  assert.equal(s.isActive(new Date(now.getTime() + 7 * DAY - 1)), true);
  assert.equal(s.isActive(new Date(now.getTime() + 7 * DAY)), false);
  s.touch({ refreshHash: 'h2', now: new Date(now.getTime() + 28 * DAY), policy: { idleDays: 7, maxDays: 30 } });
  assert.equal(s.expiresAt.getTime(), now.getTime() + 30 * DAY);
});

test('client IP: first hop of x-forwarded-for, else the socket address', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }, ip: '10.0.0.2' }), '203.0.113.7');
  assert.equal(clientIp({ headers: {}, ip: '::ffff:172.18.0.5' }), '172.18.0.5');
  assert.equal(clientIp({ headers: {} }), null);
});

// ---------- HTTP routes ----------
async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('HTTP: session routes need a token; list / delete / revoke-others / logout answer per the API', async () => {
  const k = makeKit();
  const a = await k.signIn('device-aaaa');
  const b = await k.signIn('device-bbbb');
  const useCases = {
    login: k.login,
    refreshToken: k.refresh,
    listSessions: new ListSessions({ sessionRepo: k.sessionRepo, now: k.now }),
    revokeSession: new RevokeSession({ sessionRepo: k.sessionRepo, sessions: k.sessions, now: k.now }),
    revokeOtherSessions: new RevokeOtherSessions({ sessions: k.sessions }),
    logout: new Logout({ sessionRepo: k.sessionRepo, sessions: k.sessions }),
  };
  // Stand-in for shared verifyJwt(): "Bearer <userId>:<sid>".
  const requireAuth = (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const [sub, sid] = h.slice(7).split(':');
    req.user = { sub, sid, role: 'tourist' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/', buildAuthRouter({ authController: new AuthController(useCases), requireAuth }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));

  const auth = { authorization: `Bearer u1:${sidOf(b)}` };
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/sessions`)).status, 401);

    const list = await fetch(`${base}/sessions`, { headers: auth });
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.equal(body.sessions.length, 2);
    assert.equal(body.sessions[0].id, sidOf(b));
    assert.equal(body.sessions[0].current, true);

    const current = await fetch(`${base}/sessions/${sidOf(b)}`, { method: 'DELETE', headers: auth });
    assert.equal(current.status, 409);
    assert.equal((await current.json()).code, 'current_session');
    assert.equal((await fetch(`${base}/sessions/nope`, { method: 'DELETE', headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/sessions/${sidOf(a)}`, { method: 'DELETE', headers: auth })).status, 204);

    await k.signIn('device-cccc');
    const others = await fetch(`${base}/sessions/revoke-others`, { method: 'POST', headers: auth });
    assert.deepEqual(await others.json(), { revoked: 1 });

    assert.equal((await fetch(`${base}/logout`, { method: 'POST', headers: auth })).status, 204);
    assert.equal(k.sessionRepo.rows.get(sidOf(b)).revokeReason, 'user');

    // Login passes the User-Agent and the forwarded IP to the session.
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA_SAFARI_IPHONE, 'x-forwarded-for': '198.51.100.20' },
      body: JSON.stringify({ email: 'an@mail.com', password: 'abc12345', deviceId: 'device-http1' }),
    });
    assert.equal(login.status, 200);
    const s = k.sessionRepo.rows.get(sidOf(await login.json()));
    assert.equal(s.deviceName, 'Safari trên iPhone');
    assert.equal(s.ipAddress, '198.51.100.20');
  });
});

// ---------- Password change while signed in (R7, #256) ----------
test('change password: new hash, lockout cleared, other devices signed out, current one kept', async () => {
  const k = makeKit();
  await k.signIn('device-aaaa');
  await k.signIn('device-bbbb');
  const current = await k.signIn('device-cccc');
  k.user.failedAttempts = 2;
  const change = new ChangePassword({ userRepo: k.userRepo, hasher: fakeHasher, sessions: k.sessions });
  const res = await change.execute({
    userId: 'u1',
    currentSid: sidOf(current),
    currentPassword: 'abc12345',
    newPassword: 'new12345',
  });
  assert.deepEqual(res, { revoked: 2 });
  assert.equal(k.user.passwordHash, 'h:new12345');
  assert.equal(k.user.failedAttempts, 0);
  const active = await k.sessionRepo.listActiveByUser('u1', k.now());
  assert.deepEqual(active.map((s) => s.id), [sidOf(current)]);
  assert.deepEqual(k.revocations.marked.sort(), ['s1', 's2']);
  assert.ok(
    [...k.sessionRepo.rows.values()].filter((s) => s.id !== sidOf(current)).every((s) => s.revokeReason === 'password_change'),
  );
});

test('change password: wrong current, weak or unchanged new password, banned or unknown user', async () => {
  const k = makeKit();
  await k.signIn('device-aaaa');
  const change = new ChangePassword({ userRepo: k.userRepo, hasher: fakeHasher, sessions: k.sessions });
  const run = (input) => change.execute({ userId: 'u1', currentSid: 's1', ...input });

  await assert.rejects(run({ currentPassword: 'nope1234', newPassword: 'new12345' }), { status: 400, code: 'wrong_password' });
  await assert.rejects(run({ currentPassword: 'abc12345', newPassword: 'short1' }), { code: 'validation_error' });
  await assert.rejects(run({ currentPassword: 'abc12345', newPassword: 'abc12345' }), { code: 'validation_error' });
  assert.equal(k.user.passwordHash, 'h:abc12345');
  assert.equal((await k.sessionRepo.listActiveByUser('u1', k.now())).length, 1);

  await assert.rejects(change.execute({ userId: 'ghost', currentPassword: 'abc12345', newPassword: 'new12345' }), {
    code: 'invalid_token',
  });
  k.user.status = 'banned';
  await assert.rejects(run({ currentPassword: 'abc12345', newPassword: 'new12345' }), { status: 403, code: 'account_banned' });
});

test('HTTP: POST /change-password needs a token and a body, then signs out the other devices', async () => {
  const k = makeKit();
  await k.signIn('device-aaaa');
  const b = await k.signIn('device-bbbb');
  const useCases = { changePassword: new ChangePassword({ userRepo: k.userRepo, hasher: fakeHasher, sessions: k.sessions }) };
  const requireAuth = (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const [sub, sid] = h.slice(7).split(':');
    req.user = { sub, sid, role: 'tourist' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/', buildAuthRouter({ authController: new AuthController(useCases), requireAuth }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));

  const post = (base, body, auth = true) =>
    fetch(`${base}/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer u1:${sidOf(b)}` } : {}) },
      body: JSON.stringify(body),
    });
  await withServer(app, async (base) => {
    assert.equal((await post(base, { currentPassword: 'abc12345', newPassword: 'new12345' }, false)).status, 401);
    assert.equal((await post(base, { newPassword: 'new12345' })).status, 400);
    const wrong = await post(base, { currentPassword: 'nope1234', newPassword: 'new12345' });
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).code, 'wrong_password');

    const ok = await post(base, { currentPassword: 'abc12345', newPassword: 'new12345' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).revoked, 1);
    assert.equal(k.sessionRepo.rows.get('s1').revokeReason, 'password_change');
    assert.equal(k.sessionRepo.rows.get(sidOf(b)).revokedAt, null);
  });
});
