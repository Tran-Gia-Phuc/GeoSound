// Tests for shared/middleware verifyJwt: roles (unchanged) and the UC23 session revocation check.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  verifyJwt,
  setSessionRevocationCheck,
  createRedisRevocationCheck,
} from '../middleware/index.js';

const SECRET = 'test-access-secret';
process.env.JWT_ACCESS_SECRET = SECRET;

const sign = (payload) => jwt.sign(payload, SECRET, { expiresIn: '15m' });

// Runs a middleware and resolves with { status, body } or { next: true, user }.
function run(mw, token) {
  return new Promise((resolve, reject) => {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
        return this;
      },
    };
    const next = (err) => (err ? reject(err) : resolve({ next: true, user: req.user }));
    mw(req, res, next);
  });
}

const silenceWarn = (t) => t.mock.method(console, 'warn', () => {});

afterEach(() => setSessionRevocationCheck(null));

test('without a token: 401; bad token: 401; wrong role: 403; good: next with req.user', async () => {
  assert.equal((await run(verifyJwt(), null)).status, 401);
  assert.equal((await run(verifyJwt(), 'nope')).status, 401);
  assert.equal((await run(verifyJwt(['admin']), sign({ sub: 'u1', role: 'tourist' }))).status, 403);
  const ok = await run(verifyJwt(['tourist']), sign({ sub: 'u1', role: 'tourist' }));
  assert.equal(ok.next, true);
  assert.equal(ok.user.sub, 'u1');
});

test('no check configured: a token with sid passes synchronously as before', () => {
  let called = false;
  const req = { headers: { authorization: `Bearer ${sign({ sub: 'u1', role: 'tourist', sid: 's1' })}` } };
  verifyJwt()(req, {}, () => {
    called = true;
  });
  assert.equal(called, true);
});

test('revoked sid -> 401 session_revoked; other sid passes', async () => {
  setSessionRevocationCheck(async (sid) => sid === 's-revoked');
  const revoked = await run(verifyJwt(), sign({ sub: 'u1', role: 'tourist', sid: 's-revoked' }));
  assert.equal(revoked.status, 401);
  assert.deepEqual(revoked.body, { error: 'Phiên đăng nhập đã kết thúc', code: 'session_revoked' });
  const ok = await run(verifyJwt(), sign({ sub: 'u1', role: 'tourist', sid: 's-ok' }));
  assert.equal(ok.next, true);
  assert.equal(ok.user.sid, 's-ok');
});

test('a revoked sid is rejected before the role check', async () => {
  setSessionRevocationCheck(async () => true);
  const r = await run(verifyJwt(['admin']), sign({ sub: 'u1', role: 'tourist', sid: 's1' }));
  assert.equal(r.status, 401);
});

test('old tokens without sid are never checked', async () => {
  let calls = 0;
  setSessionRevocationCheck(async () => {
    calls += 1;
    return true;
  });
  const r = await run(verifyJwt(), sign({ sub: 'u1', role: 'tourist' }));
  assert.equal(r.next, true);
  assert.equal(calls, 0);
});

test('check error -> fail open (request passes), warned once', async (t) => {
  const warn = silenceWarn(t);
  setSessionRevocationCheck(async () => {
    throw new Error('ECONNREFUSED');
  });
  const token = sign({ sub: 'u1', role: 'tourist', sid: 's1' });
  assert.equal((await run(verifyJwt(), token)).next, true);
  assert.equal((await run(verifyJwt(), token)).next, true);
  assert.equal(warn.mock.callCount(), 1);
});

test('options.isRevoked overrides the module-level check', async () => {
  setSessionRevocationCheck(async () => false);
  const r = await run(verifyJwt([], { isRevoked: async () => true }), sign({ sub: 'u1', role: 'tourist', sid: 's1' }));
  assert.equal(r.status, 401);
});

test('createRedisRevocationCheck reads revoked:sid:<sid>', async () => {
  const keys = [];
  const redis = {
    async get(key) {
      keys.push(key);
      return key === 'revoked:sid:s1' ? '1' : null;
    },
  };
  const check = createRedisRevocationCheck(redis);
  assert.equal(await check('s1'), true);
  assert.equal(await check('s2'), false);
  assert.deepEqual(keys, ['revoked:sid:s1', 'revoked:sid:s2']);
});

test('createRedisRevocationCheck: a hanging Redis times out and verifyJwt fails open', async (t) => {
  silenceWarn(t);
  const redis = { get: () => new Promise(() => {}) };
  setSessionRevocationCheck(createRedisRevocationCheck(redis, { timeoutMs: 20 }));
  const r = await run(verifyJwt(), sign({ sub: 'u1', role: 'tourist', sid: 's1' }));
  assert.equal(r.next, true);
});
