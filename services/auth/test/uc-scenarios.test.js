// =========================================================
// UC01 / UC23 / UC21 — use-case level scenarios: whole user journeys that chain the real Auth
// use cases, the real SessionManager, JwtTokenService and RedisRevocationStore, and the shared
// verifyJwt() with its Redis revocation check. Only the storage is faked in memory (users,
// challenges, sessions, Redis, mail, broker): no DB, Redis, SMTP or network.
// Single steps are covered by uc01.test.js, uc23-sessions.test.js and uc21-account-actions.test.js.
// Published payloads are checked with the shared zod contract.
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

import { User } from '../src/domain/entities/user.js';
import { SessionManager, NEW_DEVICE_LOGIN_EVENT } from '../src/application/services/session-manager.js';
import { RegisterUser } from '../src/application/use-cases/register-user.js';
import { VerifyRegistrationOtp } from '../src/application/use-cases/verify-registration-otp.js';
import { Login } from '../src/application/use-cases/login.js';
import { ForgotPassword } from '../src/application/use-cases/forgot-password.js';
import { ResetPassword } from '../src/application/use-cases/reset-password.js';
import { RefreshToken } from '../src/application/use-cases/refresh-token.js';
import { ListSessions } from '../src/application/use-cases/list-sessions.js';
import { RevokeSession } from '../src/application/use-cases/revoke-session.js';
import { Logout } from '../src/application/use-cases/logout.js';
import { ChangePassword } from '../src/application/use-cases/change-password.js';
import { RevokeAllSessions } from '../src/application/use-cases/revoke-all-sessions.js';
import { WarnUser, SuspendUser, BanUser, RestoreUser, ACCOUNT_MODERATED_EVENT } from '../src/application/use-cases/account-actions.js';
import { JwtTokenService } from '../src/infrastructure/security/jwt-token-service.js';
import { RedisRevocationStore } from '../src/infrastructure/cache/redis-revocation-store.js';

// Shared code: repo layout (CI) first, then the image layout (/app/shared).
async function loadShared(sub) {
  let lastErr;
  for (const rel of [`../../../shared/${sub}/index.js`, `../shared/${sub}/index.js`]) {
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
const { validateEvent } = await loadShared('events');
const { verifyJwt, createRedisRevocationCheck } = await loadShared('middleware');

// verifyJwt reads the access secret from the environment, like in every service.
const ACCESS_SECRET = 'scenario-access-secret';
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'abc12345';
const LAPTOP = 'device-laptop-0001';
const PHONE = 'device-phone-00002';
const UA_LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const UA_PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const silent = { log() {}, warn() {}, error() {} };

// ---------- Fakes (storage only) ----------
// Rows are plain objects; every read returns a fresh User (like Prisma).
class FakeUserRepo {
  constructor() {
    this.rows = new Map();
    this.seq = 0;
  }
  seed(props) {
    const row = { status: 'active', banReason: null, suspendedUntil: null, failedAttempts: 0, lockedUntil: null, ...props };
    this.rows.set(row.id, row);
  }
  async findById(id) {
    const row = this.rows.get(id);
    return row ? new User({ ...row }) : null;
  }
  async findByEmail(email) {
    const row = [...this.rows.values()].find((r) => r.email === email);
    return row ? new User({ ...row }) : null;
  }
  async create(user) {
    const row = { ...user, id: `u${++this.seq}` };
    this.rows.set(row.id, row);
    return new User({ ...row });
  }
  // Same columns as PrismaUserRepository.save: never the UC21 status.
  async save(user) {
    const row = this.rows.get(user.id);
    Object.assign(row, {
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      role: user.role,
      failedAttempts: user.failedAttempts,
      lockedUntil: user.lockedUntil,
    });
    return new User({ ...row });
  }
  async updateStatusIf(id, expected, next) {
    const row = this.rows.get(id);
    const same = (a, b) => (a?.getTime?.() ?? a ?? null) === (b?.getTime?.() ?? b ?? null);
    if (!row || row.status !== expected.status || !same(row.suspendedUntil, expected.suspendedUntil)) return false;
    Object.assign(row, next);
    return true;
  }
}

class FakeChallenges {
  constructor() {
    this.map = new Map();
  }
  async save(kind, email, payload) {
    this.map.set(`${kind}:${email}`, payload);
  }
  async get(kind, email) {
    return this.map.get(`${kind}:${email}`) ?? null;
  }
  async delete(kind, email) {
    this.map.delete(`${kind}:${email}`);
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
}

// Enough of ioredis for RedisRevocationStore (set ... EX) and createRedisRevocationCheck (get).
class FakeRedis {
  constructor() {
    this.map = new Map();
  }
  async set(key, value) {
    this.map.set(key, value);
    return 'OK';
  }
  async get(key) {
    return this.map.get(key) ?? null;
  }
}

class FakeMailer {
  constructor() {
    this.sent = [];
  }
  async sendOtp(email, code, kind) {
    this.sent.push({ email, code, kind });
  }
  last(kind) {
    return this.sent.filter((m) => m.kind === kind).at(-1);
  }
}

// Like shared publish(): every payload must pass the contract. SessionManager swallows publish
// errors, so a contract failure is recorded instead of thrown and the tests assert none happened.
class ValidatingPublisher {
  constructor() {
    this.events = [];
    this.invalid = [];
  }
  async publish(name, payload) {
    try {
      validateEvent(name, payload);
    } catch (err) {
      this.invalid.push({ name, error: err.message });
      throw err;
    }
    this.events.push({ name, payload });
  }
  named(name) {
    return this.events.filter((e) => e.name === name).map((e) => e.payload);
  }
}

const fakeHasher = {
  async hash(p) {
    return `h:${p}`;
  },
  async compare(p, h) {
    return h === `h:${p}`;
  },
};

// ---------- Kit: the container wiring of src/container.js, with the fakes above ----------
function makeKit() {
  const clock = { t: Date.now() };
  const now = () => new Date(clock.t);
  const userRepo = new FakeUserRepo();
  const challenges = new FakeChallenges();
  const sessionRepo = new FakeSessionRepo();
  const redis = new FakeRedis();
  const mailer = new FakeMailer();
  const publisher = new ValidatingPublisher();
  let otpSeq = 0;
  const otp = { generate: () => String(100000 + ++otpSeq) }; // a new code for every OTP mail
  const tokens = new JwtTokenService({
    accessSecret: ACCESS_SECRET,
    refreshSecret: 'scenario-refresh-secret',
    accessTtl: '15m',
    refreshTtl: '7d',
  });
  const policy = { idleDays: 7, maxDays: 30, maxSessions: 10 };
  let sidSeq = 0;
  const sessions = new SessionManager({
    sessionRepo,
    tokens,
    revocations: new RedisRevocationStore(redis, { ttlSeconds: 900 }),
    publisher,
    policy,
    now,
    newId: () => `s${++sidSeq}`,
    logger: silent,
  });
  const otpTtlSeconds = 120;
  const revokeAllSessions = new RevokeAllSessions({ sessions });
  const actionDeps = { userRepo, revokeAllSessions, publisher, now, logger: silent };
  const uc = {
    register: new RegisterUser({ userRepo, hasher: fakeHasher, challenges, otp, mailer, otpTtlSeconds }),
    verify: new VerifyRegistrationOtp({ userRepo, challenges }),
    login: new Login({ userRepo, hasher: fakeHasher, tokens, policy: { maxAttempts: 5, lockMs: 15 * 60_000 }, sessions, now }),
    forgot: new ForgotPassword({ userRepo, challenges, otp, mailer, otpTtlSeconds }),
    reset: new ResetPassword({ userRepo, hasher: fakeHasher, challenges, sessions }),
    refresh: new RefreshToken({ userRepo, tokens, sessions, sessionRepo, policy, now }),
    listSessions: new ListSessions({ sessionRepo, now }),
    revokeSession: new RevokeSession({ sessionRepo, sessions, now }),
    logout: new Logout({ sessionRepo, sessions }),
    changePassword: new ChangePassword({ userRepo, hasher: fakeHasher, sessions }),
    warn: new WarnUser(actionDeps),
    suspend: new SuspendUser(actionDeps),
    ban: new BanUser(actionDeps),
    restore: new RestoreUser(actionDeps),
  };
  // The guard of every protected route, with the revocation check on the same Redis.
  const guard = verifyJwt([], { isRevoked: createRedisRevocationCheck(redis) });

  /** Runs the guard on an access token: { status: 200, user } or { status, body }. */
  const authorize = (accessToken) =>
    new Promise((resolve) => {
      const req = { headers: { authorization: `Bearer ${accessToken}` } };
      const res = {
        status(code) {
          this.code = code;
          return this;
        },
        json(body) {
          resolve({ status: this.code, body });
        },
      };
      guard(req, res, () => resolve({ status: 200, user: req.user }));
    });

  const signIn = (email, deviceId, userAgent = UA_LAPTOP, password = PASSWORD) =>
    uc.login.execute({ email, password, deviceId, userAgent, ip: '203.0.113.7' });

  /** UC01 A1: register, read the OTP from the mail, verify. */
  const registerVerified = async (email, { fullName = 'An', role = 'contributor' } = {}) => {
    await uc.register.execute({ fullName, email, password: PASSWORD, role });
    const user = await uc.verify.execute({ email, otp: mailer.last('register').code });
    return user;
  };

  const advance = (ms) => {
    clock.t += ms;
  };
  return { uc, userRepo, sessionRepo, redis, mailer, publisher, authorize, signIn, registerVerified, advance, now };
}

const sidOf = (token) => jwt.decode(token).sid;
const withCode = (code) => (err) => err.code === code;
const ADMIN = { id: 'admin-1', email: 'admin@mail.com', passwordHash: `h:${PASSWORD}`, fullName: 'Admin', role: 'admin' };

// ---------- UC01: register, sign in, reset the password ----------
test('UC01: register -> OTP mail -> verify -> sign in returns access + refresh carrying the same sid', async () => {
  const k = makeKit();
  await k.uc.register.execute({ fullName: 'An', email: 'An@Mail.com', password: PASSWORD, role: 'contributor' });
  const mail = k.mailer.last('register');
  assert.equal(mail.email, 'an@mail.com');

  // Not verified yet: no account exists, so sign-in gives the generic error (E2, no enumeration).
  await assert.rejects(() => k.signIn('an@mail.com', LAPTOP), withCode('invalid_credentials'));
  await assert.rejects(() => k.uc.verify.execute({ email: 'an@mail.com', otp: '000000' }), withCode('invalid_otp'));

  const user = await k.uc.verify.execute({ email: 'an@mail.com', otp: mail.code });
  assert.equal(user.role, 'contributor');
  // The OTP is single use.
  await assert.rejects(() => k.uc.verify.execute({ email: 'an@mail.com', otp: mail.code }), withCode('challenge_expired'));

  const res = await k.signIn('an@mail.com', LAPTOP);
  assert.equal(res.user.email, 'an@mail.com');
  const sid = sidOf(res.accessToken);
  assert.ok(sid);
  assert.equal(jwt.decode(res.refreshToken).sid, sid);
  assert.equal(res.expiresIn, '15m');

  const auth = await k.authorize(res.accessToken);
  assert.equal(auth.status, 200);
  assert.equal(auth.user.sub, user.id);
  assert.equal(auth.user.role, 'contributor');

  // First sign-in on this device: one new-device alert, valid for the shared contract.
  assert.deepEqual(k.publisher.invalid, []);
  const alerts = k.publisher.named(NEW_DEVICE_LOGIN_EVENT);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].email, 'an@mail.com');
  assert.equal(alerts[0].deviceName, 'Chrome trên Windows');
});

test('UC01: wrong password and unknown email get the same 401; the lockout starts after the limit', async () => {
  const k = makeKit();
  await k.registerVerified('an@mail.com');
  await assert.rejects(() => k.signIn('an@mail.com', LAPTOP, UA_LAPTOP, 'wrong123'), withCode('invalid_credentials'));
  await assert.rejects(() => k.signIn('nobody@mail.com', LAPTOP), withCode('invalid_credentials'));
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => k.signIn('an@mail.com', LAPTOP, UA_LAPTOP, 'wrong123'), withCode('invalid_credentials'));
  }
  // 5th wrong attempt reaches the limit: locked, even with the right password.
  await assert.rejects(() => k.signIn('an@mail.com', LAPTOP, UA_LAPTOP, 'wrong123'), withCode('account_locked'));
  await assert.rejects(() => k.signIn('an@mail.com', LAPTOP), withCode('account_locked'));
  assert.equal(k.sessionRepo.rows.size, 0, 'no session for a refused sign-in');

  k.advance(16 * 60_000);
  const res = await k.signIn('an@mail.com', LAPTOP);
  assert.ok(res.accessToken);
});

test('UC01 A2: forgot -> OTP -> reset signs out every device; the old password fails, the new one works', async () => {
  const k = makeKit();
  await k.registerVerified('an@mail.com');
  const laptop = await k.signIn('an@mail.com', LAPTOP);
  const phone = await k.signIn('an@mail.com', PHONE, UA_PHONE);

  // Unknown email: same answer, no mail (no enumeration).
  const unknown = await k.uc.forgot.execute({ email: 'nobody@mail.com' });
  assert.equal(unknown.otpTtlSeconds, 120);
  assert.equal(k.mailer.last('reset'), undefined);

  await k.uc.forgot.execute({ email: 'an@mail.com' });
  const code = k.mailer.last('reset').code;
  await assert.rejects(
    () => k.uc.reset.execute({ email: 'an@mail.com', otp: '000000', newPassword: 'new12345' }),
    withCode('invalid_otp'),
  );
  await k.uc.reset.execute({ email: 'an@mail.com', otp: code, newPassword: 'new12345' });

  await assert.rejects(() => k.signIn('an@mail.com', LAPTOP), withCode('invalid_credentials'));
  const again = await k.signIn('an@mail.com', LAPTOP, UA_LAPTOP, 'new12345');
  assert.equal((await k.authorize(again.accessToken)).status, 200);

  // R7: both devices signed in before the reset are out, access and refresh tokens alike.
  for (const old of [laptop, phone]) {
    const auth = await k.authorize(old.accessToken);
    assert.equal(auth.status, 401);
    assert.equal(auth.body.code, 'session_revoked');
    await assert.rejects(() => k.uc.refresh.execute({ refreshToken: old.refreshToken }), withCode('session_revoked'));
  }
  assert.equal(k.sessionRepo.rows.get(sidOf(phone.accessToken)).revokeReason, 'password_reset');
  // The reset OTP is single use.
  await assert.rejects(
    () => k.uc.reset.execute({ email: 'an@mail.com', otp: code, newPassword: 'other123' }),
    withCode('challenge_expired'),
  );
});

// ---------- UC23: signed-in devices ----------
test('UC23: two devices -> the list shows both, the current one first and flagged, no IP or hash', async () => {
  const k = makeKit();
  const user = await k.registerVerified('an@mail.com');
  const laptop = await k.signIn('an@mail.com', LAPTOP);
  k.advance(60_000);
  const phone = await k.signIn('an@mail.com', PHONE, UA_PHONE);

  const fromLaptop = await k.uc.listSessions.execute({ userId: user.id, currentSid: sidOf(laptop.accessToken) });
  assert.deepEqual(
    fromLaptop.sessions.map((s) => [s.id, s.current, s.deviceName]),
    [
      [sidOf(laptop.accessToken), true, 'Chrome trên Windows'],
      [sidOf(phone.accessToken), false, 'Safari trên iPhone'],
    ],
  );
  for (const s of fromLaptop.sessions) {
    assert.equal(s.ipAddress, undefined);
    assert.equal(s.refreshHash, undefined);
  }
  // Seen from the phone, the phone is current.
  const fromPhone = await k.uc.listSessions.execute({ userId: user.id, currentSid: sidOf(phone.accessToken) });
  assert.equal(fromPhone.sessions[0].id, sidOf(phone.accessToken));
  assert.equal(fromPhone.sessions[0].current, true);
  assert.equal(k.publisher.named(NEW_DEVICE_LOGIN_EVENT).length, 2, 'one alert per new device');
  assert.deepEqual(k.publisher.invalid, []);
});

test('UC23: signing in again on the same device replaces its session; it is not a new device', async () => {
  const k = makeKit();
  const user = await k.registerVerified('an@mail.com');
  const first = await k.signIn('an@mail.com', LAPTOP);
  const second = await k.signIn('an@mail.com', LAPTOP);

  assert.notEqual(sidOf(first.accessToken), sidOf(second.accessToken));
  assert.equal((await k.authorize(first.accessToken)).body?.code, 'session_revoked');
  assert.equal((await k.authorize(second.accessToken)).status, 200);
  const { sessions } = await k.uc.listSessions.execute({ userId: user.id, currentSid: sidOf(second.accessToken) });
  assert.equal(sessions.length, 1);
  assert.equal(k.publisher.named(NEW_DEVICE_LOGIN_EVENT).length, 1);
});

test('UC23 R11: refresh rotates the token; reusing the old one signs that device out, not the other', async () => {
  const k = makeKit();
  const user = await k.registerVerified('an@mail.com');
  const laptop = await k.signIn('an@mail.com', LAPTOP);
  const phone = await k.signIn('an@mail.com', PHONE, UA_PHONE);
  const sid = sidOf(laptop.accessToken);

  const rotated = await k.uc.refresh.execute({ refreshToken: laptop.refreshToken, deviceId: LAPTOP });
  assert.notEqual(rotated.refreshToken, laptop.refreshToken);
  assert.equal(sidOf(rotated.accessToken), sid, 'same session, new tokens');
  assert.equal((await k.authorize(rotated.accessToken)).status, 200);

  // The old refresh token comes back (stolen copy): the session ends with reason reuse.
  await assert.rejects(() => k.uc.refresh.execute({ refreshToken: laptop.refreshToken }), withCode('session_revoked'));
  assert.equal(k.sessionRepo.rows.get(sid).revokeReason, 'reuse');
  // Every token of that session is now dead, the rotated one included.
  await assert.rejects(() => k.uc.refresh.execute({ refreshToken: rotated.refreshToken }), withCode('session_revoked'));
  assert.equal((await k.authorize(rotated.accessToken)).body?.code, 'session_revoked');
  assert.equal((await k.authorize(laptop.accessToken)).body?.code, 'session_revoked');

  // The phone is untouched.
  assert.equal((await k.authorize(phone.accessToken)).status, 200);
  const phoneRefresh = await k.uc.refresh.execute({ refreshToken: phone.refreshToken });
  assert.ok(phoneRefresh.accessToken);
  const { sessions } = await k.uc.listSessions.execute({ userId: user.id, currentSid: sidOf(phone.accessToken) });
  assert.deepEqual(sessions.map((s) => s.id), [sidOf(phone.accessToken)]);
});

test('UC23 R4: revoking the phone from the laptop -> phone access + refresh rejected, laptop still works', async () => {
  const k = makeKit();
  const user = await k.registerVerified('an@mail.com');
  const laptop = await k.signIn('an@mail.com', LAPTOP);
  const phone = await k.signIn('an@mail.com', PHONE, UA_PHONE);
  const current = sidOf(laptop.accessToken);

  // The current device cannot be revoked here (logout is the way); another user's session is 404.
  await assert.rejects(
    () => k.uc.revokeSession.execute({ userId: user.id, currentSid: current, sessionId: current }),
    withCode('current_session'),
  );
  await assert.rejects(
    () => k.uc.revokeSession.execute({ userId: 'someone-else', currentSid: null, sessionId: sidOf(phone.accessToken) }),
    withCode('session_not_found'),
  );

  await k.uc.revokeSession.execute({ userId: user.id, currentSid: current, sessionId: sidOf(phone.accessToken) });
  const phoneAuth = await k.authorize(phone.accessToken);
  assert.equal(phoneAuth.status, 401);
  assert.equal(phoneAuth.body.code, 'session_revoked');
  await assert.rejects(() => k.uc.refresh.execute({ refreshToken: phone.refreshToken }), withCode('session_revoked'));
  assert.equal((await k.authorize(laptop.accessToken)).status, 200);

  // Revoking it twice: it is no longer active -> 404.
  await assert.rejects(
    () => k.uc.revokeSession.execute({ userId: user.id, currentSid: current, sessionId: sidOf(phone.accessToken) }),
    withCode('session_not_found'),
  );

  // Logout ends the laptop too.
  assert.deepEqual(await k.uc.logout.execute({ userId: user.id, currentSid: current }), { revoked: true });
  assert.equal((await k.authorize(laptop.accessToken)).body?.code, 'session_revoked');
  assert.deepEqual((await k.uc.listSessions.execute({ userId: user.id })).sessions, []);
});

test('UC23 R7: change password while signed in -> other devices out, current kept, old password refused', async () => {
  const k = makeKit();
  const user = await k.registerVerified('an@mail.com');
  const laptop = await k.signIn('an@mail.com', LAPTOP);
  const phone = await k.signIn('an@mail.com', PHONE, UA_PHONE);

  await assert.rejects(
    () => k.uc.changePassword.execute({ userId: user.id, currentSid: sidOf(laptop.accessToken), currentPassword: 'wrong123', newPassword: 'new12345' }),
    withCode('wrong_password'),
  );
  assert.equal((await k.authorize(phone.accessToken)).status, 200, 'a refused change signs nobody out');

  const res = await k.uc.changePassword.execute({
    userId: user.id,
    currentSid: sidOf(laptop.accessToken),
    currentPassword: PASSWORD,
    newPassword: 'new12345',
  });
  assert.deepEqual(res, { revoked: 1 });

  assert.equal((await k.authorize(phone.accessToken)).body?.code, 'session_revoked');
  await assert.rejects(() => k.uc.refresh.execute({ refreshToken: phone.refreshToken }), withCode('session_revoked'));
  assert.equal(k.sessionRepo.rows.get(sidOf(phone.accessToken)).revokeReason, 'password_change');
  assert.equal((await k.authorize(laptop.accessToken)).status, 200);
  assert.ok((await k.uc.refresh.execute({ refreshToken: laptop.refreshToken })).accessToken);

  await assert.rejects(() => k.signIn('an@mail.com', PHONE, UA_PHONE), withCode('invalid_credentials'));
  assert.ok((await k.signIn('an@mail.com', PHONE, UA_PHONE, 'new12345')).accessToken);
});

// ---------- UC21: admin account actions ----------
test('UC21: suspend 7 days -> every device out, sign-in and refresh 403 account_suspended; restore -> sign-in works', async () => {
  const k = makeKit();
  k.userRepo.seed(ADMIN);
  const user = await k.registerVerified('an@mail.com');
  const laptop = await k.signIn('an@mail.com', LAPTOP);
  const phone = await k.signIn('an@mail.com', PHONE, UA_PHONE);

  const res = await k.uc.suspend.execute({ userId: user.id, adminId: ADMIN.id, reason: 'Spam nhiều lần', days: 7 });
  assert.equal(res.sessionsRevoked, 2);
  for (const t of [laptop, phone]) {
    assert.equal((await k.authorize(t.accessToken)).body?.code, 'session_revoked');
    await assert.rejects(() => k.uc.refresh.execute({ refreshToken: t.refreshToken }), withCode('account_suspended'));
    assert.equal(k.sessionRepo.rows.get(sidOf(t.accessToken)).revokeReason, 'suspended');
  }
  await assert.rejects(() => k.signIn('an@mail.com', LAPTOP), withCode('account_suspended'));

  const [suspended] = k.publisher.named(ACCOUNT_MODERATED_EVENT);
  assert.equal(suspended.action, 'suspend');
  assert.equal(suspended.userId, user.id);
  assert.equal(suspended.adminId, ADMIN.id);
  assert.equal(suspended.email, 'an@mail.com');
  assert.equal(suspended.until, new Date(k.now().getTime() + 7 * DAY).toISOString());

  await k.uc.restore.execute({ userId: user.id, adminId: ADMIN.id, reason: 'Đã xác minh' });
  const back = await k.signIn('an@mail.com', LAPTOP);
  assert.equal((await k.authorize(back.accessToken)).status, 200);
  assert.deepEqual(
    k.publisher.named(ACCOUNT_MODERATED_EVENT).map((e) => e.action),
    ['suspend', 'restore'],
  );
  assert.deepEqual(k.publisher.invalid, []);
});

test('UC21: once the suspension end passes, sign-in works without a restore; restore then answers 409', async () => {
  const k = makeKit();
  k.userRepo.seed(ADMIN);
  const user = await k.registerVerified('an@mail.com');
  await k.uc.suspend.execute({ userId: user.id, adminId: ADMIN.id, reason: 'Spam', days: 1 });
  await assert.rejects(() => k.signIn('an@mail.com', LAPTOP), withCode('account_suspended'));

  k.advance(DAY + 60_000);
  const res = await k.signIn('an@mail.com', LAPTOP);
  assert.equal((await k.authorize(res.accessToken)).status, 200);
  await assert.rejects(
    () => k.uc.restore.execute({ userId: user.id, adminId: ADMIN.id }),
    withCode('account_not_restricted'),
  );
});

test('UC21: ban -> every device out, sign-in / refresh 403 account_banned, no reset mail; ban twice 409; restore -> works', async () => {
  const k = makeKit();
  k.userRepo.seed(ADMIN);
  const user = await k.registerVerified('an@mail.com');
  const laptop = await k.signIn('an@mail.com', LAPTOP);

  const res = await k.uc.ban.execute({ userId: user.id, adminId: ADMIN.id, reason: 'Lừa đảo' });
  assert.equal(res.sessionsRevoked, 1);
  assert.equal((await k.authorize(laptop.accessToken)).body?.code, 'session_revoked');
  await assert.rejects(() => k.uc.refresh.execute({ refreshToken: laptop.refreshToken }), withCode('account_banned'));
  await assert.rejects(() => k.signIn('an@mail.com', LAPTOP), withCode('account_banned'));
  // A banned account gets no reset OTP (same answer as for any email).
  await k.uc.forgot.execute({ email: 'an@mail.com' });
  assert.equal(k.mailer.last('reset'), undefined);
  await assert.rejects(
    () => k.uc.ban.execute({ userId: user.id, adminId: ADMIN.id, reason: 'Lần nữa' }),
    withCode('account_already_banned'),
  );
  await assert.rejects(
    () => k.uc.suspend.execute({ userId: user.id, adminId: ADMIN.id, reason: 'x', days: 1 }),
    withCode('account_already_banned'),
  );

  await k.uc.restore.execute({ userId: user.id, adminId: ADMIN.id });
  assert.ok((await k.signIn('an@mail.com', LAPTOP)).accessToken);
  const events = k.publisher.named(ACCOUNT_MODERATED_EVENT);
  assert.deepEqual(events.map((e) => e.action), ['ban', 'restore']);
  assert.equal(events[0].reason, 'Lừa đảo');
  assert.deepEqual(k.publisher.invalid, []);
});

test('UC21: warn changes nothing but the event; sessions and sign-in keep working', async () => {
  const k = makeKit();
  k.userRepo.seed(ADMIN);
  const user = await k.registerVerified('an@mail.com');
  const laptop = await k.signIn('an@mail.com', LAPTOP);

  const res = await k.uc.warn.execute({ userId: user.id, adminId: ADMIN.id, reason: 'Mô tả sai sự thật' });
  assert.equal(res.action, 'warn');
  assert.equal(res.user.status, 'active');
  assert.equal((await k.authorize(laptop.accessToken)).status, 200);
  assert.ok((await k.uc.refresh.execute({ refreshToken: laptop.refreshToken })).accessToken);
  const [warned] = k.publisher.named(ACCOUNT_MODERATED_EVENT);
  assert.equal(warned.action, 'warn');
  assert.equal(warned.until, undefined);
  assert.deepEqual(k.publisher.invalid, []);
});

test('UC21 guards: an admin cannot act on their own account or on another admin; nothing changes', async () => {
  const k = makeKit();
  k.userRepo.seed(ADMIN);
  k.userRepo.seed({ ...ADMIN, id: 'admin-2', email: 'admin2@mail.com', fullName: 'Admin 2' });
  const own = await k.signIn('admin@mail.com', LAPTOP);
  const other = await k.signIn('admin2@mail.com', PHONE, UA_PHONE);
  assert.equal((await k.authorize(own.accessToken)).user.role, 'admin');

  for (const action of ['warn', 'suspend', 'ban', 'restore']) {
    const input = { adminId: ADMIN.id, reason: 'x', days: 1 };
    await assert.rejects(() => k.uc[action].execute({ ...input, userId: ADMIN.id }), withCode('self_action'));
    await assert.rejects(() => k.uc[action].execute({ ...input, userId: 'admin-2' }), withCode('target_is_admin'));
  }
  await assert.rejects(
    () => k.uc.ban.execute({ userId: 'missing', adminId: ADMIN.id, reason: 'x' }),
    withCode('user_not_found'),
  );
  assert.equal(k.publisher.named(ACCOUNT_MODERATED_EVENT).length, 0);
  assert.equal((await k.authorize(own.accessToken)).status, 200);
  assert.equal((await k.authorize(other.accessToken)).status, 200);
  assert.ok((await k.signIn('admin2@mail.com', PHONE, UA_PHONE)).accessToken);
});
