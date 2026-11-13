// Tests for shared/health: check runner, readiness evaluation and the express routes (issue #345).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runCheck,
  evaluateReadiness,
  registerHealthRoutes,
  prismaCheck,
  redisCheck,
} from '../health/index.js';

// Minimal express stand-in: records GET handlers and calls them with a fake res.
function fakeApp() {
  const routes = {};
  return {
    get(path, handler) {
      routes[path] = handler;
    },
    async call(path) {
      return new Promise((resolve, reject) => {
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
        Promise.resolve(routes[path]({}, res)).catch(reject);
      });
    },
    routes,
  };
}

const silentLog = () => {
  const lines = [];
  return { lines, warn: (m) => lines.push(['warn', m]), log: (m) => lines.push(['log', m]) };
};

test('runCheck: resolves true unless the check returns false, throws or times out', async () => {
  assert.equal(await runCheck(() => undefined), true);
  assert.equal(await runCheck(async () => 'anything'), true);
  assert.equal(await runCheck(() => false), false);
  assert.equal(await runCheck(async () => false), false);
  assert.equal(await runCheck(() => { throw new Error('boom'); }), false);
  assert.equal(await runCheck(() => Promise.reject(new Error('boom'))), false);
  assert.equal(await runCheck(() => new Promise(() => {}), 20), false);
});

test('evaluateReadiness: only required checks decide readiness', async () => {
  const r = await evaluateReadiness({
    db: { check: () => true },
    rabbitmq: { check: () => false },
    redis: { check: () => false, required: false },
  });
  assert.equal(r.ready, false);
  assert.deepEqual(r.checks, { db: 'ok', rabbitmq: 'down', redis: 'down' });
  assert.deepEqual(r.failed, ['rabbitmq', 'redis']);

  const r2 = await evaluateReadiness({
    db: { check: () => true },
    redis: { check: () => false, required: false },
  });
  assert.equal(r2.ready, true);
  assert.deepEqual(r2.checks, { db: 'ok', redis: 'down' });
});

test('evaluateReadiness: no checks means ready', async () => {
  assert.deepEqual(await evaluateReadiness(), { ready: true, checks: {}, failed: [] });
});

test('evaluateReadiness: checks run in parallel', async () => {
  const slow = () => new Promise((r) => setTimeout(() => r(true), 60));
  const t0 = Date.now();
  const r = await evaluateReadiness({ a: { check: slow }, b: { check: slow }, c: { check: slow } });
  assert.equal(r.ready, true);
  assert.ok(Date.now() - t0 < 150, 'three 60 ms checks should take about 60 ms');
});

test('registerHealthRoutes: /healthz and /health answer without running checks', async () => {
  const app = fakeApp();
  let calls = 0;
  registerHealthRoutes(app, {
    service: 'media',
    checks: { rabbitmq: { check: () => { calls += 1; return false; } } },
    extra: { storage: 'LocalDiskStorage' },
    log: silentLog(),
  });
  for (const path of ['/healthz', '/health']) {
    const res = await app.call(path);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok', service: 'media', storage: 'LocalDiskStorage' });
  }
  assert.equal(calls, 0);
});

test('registerHealthRoutes: extra can be a function', async () => {
  const app = fakeApp();
  registerHealthRoutes(app, { service: 'x', extra: () => ({ n: 1 }), log: silentLog() });
  assert.deepEqual((await app.call('/healthz')).body, { status: 'ok', service: 'x', n: 1 });
});

test('registerHealthRoutes: /readyz is 503 while a required check is down, 200 when back', async () => {
  const app = fakeApp();
  const log = silentLog();
  let rabbitUp = false;
  registerHealthRoutes(app, {
    service: 'moderation',
    checks: {
      db: { check: () => true },
      rabbitmq: { check: () => rabbitUp },
    },
    log,
  });

  let res = await app.call('/readyz');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, {
    status: 'not_ready',
    service: 'moderation',
    checks: { db: 'ok', rabbitmq: 'down' },
  });
  await app.call('/readyz'); // still down: no second log line

  rabbitUp = true;
  res = await app.call('/readyz');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ready');
  assert.deepEqual(log.lines, [
    ['warn', '[moderation] readiness: rabbitmq is down'],
    ['log', '[moderation] readiness: rabbitmq is back'],
  ]);
});

test('registerHealthRoutes: a down optional check is reported but keeps 200', async () => {
  const app = fakeApp();
  registerHealthRoutes(app, {
    service: 'gateway',
    checks: { redis: { check: () => false, required: false } },
    log: silentLog(),
  });
  const res = await app.call('/readyz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.checks, { redis: 'down' });
});

test('registerHealthRoutes: the body never carries error text', async () => {
  const app = fakeApp();
  registerHealthRoutes(app, {
    service: 'auth',
    checks: { db: { check: () => { throw new Error('password=secret host=db'); } } },
    log: silentLog(),
  });
  const res = await app.call('/readyz');
  assert.equal(res.status, 503);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});

test('registerHealthRoutes: /readyz is 503 draining during shutdown, without running checks', async () => {
  const app = fakeApp();
  let draining = false;
  let calls = 0;
  registerHealthRoutes(app, {
    service: 'tour',
    checks: { db: { check: () => { calls += 1; return true; } } },
    isDraining: () => draining,
    log: silentLog(),
  });
  assert.equal((await app.call('/readyz')).status, 200);
  draining = true;
  const res = await app.call('/readyz');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: 'draining', service: 'tour' });
  assert.equal(calls, 1);
  assert.equal((await app.call('/healthz')).status, 200); // liveness stays up while draining
});

test('registerHealthRoutes: service is required', () => {
  assert.throws(() => registerHealthRoutes(fakeApp(), {}), /service is required/);
});

test('prismaCheck: runs SELECT 1 and fails when the query throws', async () => {
  let sql = null;
  const ok = { $queryRaw: (strings) => { sql = strings.join('?'); return Promise.resolve([{ '?column?': 1 }]); } };
  assert.equal(await runCheck(prismaCheck(ok)), true);
  assert.equal(sql, 'SELECT 1');
  const bad = { $queryRaw: () => Promise.reject(new Error('down')) };
  assert.equal(await runCheck(prismaCheck(bad)), false);
});

test('redisCheck: needs status ready and PONG; accepts a client or a getter', async () => {
  const ready = { status: 'ready', ping: async () => 'PONG' };
  assert.equal(await runCheck(redisCheck(ready)), true);
  assert.equal(await runCheck(redisCheck(() => ready)), true);
  assert.equal(await runCheck(redisCheck(() => null)), false);
  assert.equal(await runCheck(redisCheck({ status: 'reconnecting', ping: async () => 'PONG' })), false);
  assert.equal(await runCheck(redisCheck({ status: 'ready', ping: async () => 'nope' })), false);
  assert.equal(await runCheck(redisCheck({ status: 'ready', ping: () => Promise.reject(new Error('x')) })), false);
});
