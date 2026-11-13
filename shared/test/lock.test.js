// Tests for shared/lock: one run per hold window across replicas, renew while running, owner-only
// release, Redis errors (issue #354). A fake Redis with a fake clock; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobLock, RENEW_SCRIPT, RELEASE_SCRIPT, LOCK_PREFIX } from '../lock/index.js';

// In-memory Redis with SET NX PX and the two scripts of the helper, on a shared fake clock.
function fakeRedis(clock) {
  const keys = new Map(); // key -> { value, expiresAt }
  const calls = [];
  const live = (key) => {
    const e = keys.get(key);
    if (e && e.expiresAt <= clock.t) keys.delete(key);
    return keys.get(key);
  };
  return {
    keys,
    calls,
    failNext: 0,
    async set(key, value, px, ms, nx) {
      calls.push(['set', key]);
      if (this.failNext > 0) { this.failNext -= 1; throw new Error('connection refused'); }
      assert.equal(px, 'PX');
      assert.equal(nx, 'NX');
      if (live(key)) return null;
      keys.set(key, { value, expiresAt: clock.t + Number(ms) });
      return 'OK';
    },
    async eval(script, numKeys, key, token, ms) {
      calls.push([script === RENEW_SCRIPT ? 'renew' : 'release', key, Number(ms)]);
      if (this.failNext > 0) { this.failNext -= 1; throw new Error('connection refused'); }
      assert.equal(numKeys, 1);
      const e = live(key);
      if (!e || e.value !== token) return 0;
      if (script === RENEW_SCRIPT || Number(ms) > 0) { e.expiresAt = clock.t + Number(ms); return 1; }
      assert.equal(script, RELEASE_SCRIPT);
      keys.delete(key);
      return 1;
    },
  };
}

function fakeTimers() {
  const t = { fn: null, ms: null, cleared: 0 };
  t.setIntervalImpl = (fn, ms) => { t.fn = fn; t.ms = ms; return { unref() {} }; };
  t.clearIntervalImpl = () => { t.cleared += 1; t.fn = null; };
  return t;
}

function setup() {
  const clock = { t: 1000 };
  const redis = fakeRedis(clock);
  const warnings = [];
  const timers = fakeTimers();
  let n = 0;
  const make = (replica) => createJobLock(redis, {
    service: 'svc',
    logger: { warn: (m) => warnings.push(m) },
    now: () => clock.t,
    newToken: () => `${replica}-${(n += 1)}`,
    ...timers,
  });
  return { clock, redis, warnings, timers, a: make('a'), b: make('b') };
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('createJobLock: redis and service are required', () => {
  assert.throws(() => createJobLock(null, { service: 's' }), /redis/);
  assert.throws(() => createJobLock({}, {}), /service/);
});

test('runOnce: runs fn and returns its result; ttlMs is required', async () => {
  const { a, redis } = setup();
  assert.deepEqual(await a.runOnce('job', async () => 42, { ttlMs: 1000 }), { ran: true, result: 42, locked: true });
  assert.equal(redis.calls[0][1], `${LOCK_PREFIX}job`);
  await assert.rejects(a.runOnce('job', async () => 1, {}), /ttlMs/);
});

test('two replicas, same window: only the first runs, the second skips without a log line', async () => {
  const { a, b, warnings } = setup();
  let runs = 0;
  const opts = { ttlMs: 30000, holdMs: 48000 };
  assert.equal((await a.runOnce('sweep', async () => { runs += 1; }, opts)).ran, true);
  assert.deepEqual(await b.runOnce('sweep', async () => { runs += 1; }, opts), { ran: false, reason: 'held' });
  assert.equal(runs, 1);
  assert.deepEqual(warnings, []);
});

test('the lock is held until holdMs after the start, then the next run (any replica) gets it', async () => {
  const { a, b, clock } = setup();
  const opts = { ttlMs: 30000, holdMs: 48000 };
  await a.runOnce('sweep', async () => { clock.t += 5000; }, opts); // the job took 5 s
  clock.t += 42000; // 47 s after the start
  assert.equal((await b.runOnce('sweep', async () => {}, opts)).ran, false);
  clock.t += 2000; // 49 s after the start
  assert.equal((await b.runOnce('sweep', async () => {}, opts)).ran, true);
});

test('holdMs 0 (or a run longer than holdMs) deletes the lock at once', async () => {
  const { a, b, clock, redis } = setup();
  await a.runOnce('purge', async () => {}, { ttlMs: 30000 });
  assert.equal(redis.keys.size, 0);
  await a.runOnce('purge', async () => { clock.t += 60000; }, { ttlMs: 30000, holdMs: 50000 });
  assert.equal((await b.runOnce('purge', async () => {}, { ttlMs: 30000 })).ran, true);
});

test('a long run renews the lock every ttlMs / 3, so another replica cannot start meanwhile', async () => {
  const { a, b, clock, timers } = setup();
  const d = deferred();
  const running = a.runOnce('sweep', () => d.promise, { ttlMs: 30000, holdMs: 0 });
  await new Promise(setImmediate);
  assert.equal(timers.ms, 10000);
  for (let i = 0; i < 6; i += 1) { // 60 s of work, twice the TTL
    clock.t += 10000;
    timers.fn();
    await new Promise(setImmediate);
  }
  assert.equal((await b.runOnce('sweep', async () => {}, { ttlMs: 30000 })).ran, false);
  d.resolve('done');
  assert.deepEqual(await running, { ran: true, result: 'done', locked: true });
  assert.equal(timers.cleared, 1);
  assert.equal((await b.runOnce('sweep', async () => {}, { ttlMs: 30000 })).ran, true);
});

test('release is owner only: a lock taken over after expiry is not deleted by the old owner', async () => {
  const { a, b, clock, redis } = setup();
  const d = deferred();
  const running = a.runOnce('sweep', () => d.promise, { ttlMs: 1000 });
  await new Promise(setImmediate);
  clock.t += 2000; // no renewal ran (timer not fired): a's lock expired
  const bWork = deferred();
  const bRun = b.runOnce('sweep', () => bWork.promise, { ttlMs: 1000 });
  await new Promise(setImmediate);
  d.resolve(); // a ends while b holds the lock
  await running;
  assert.equal(redis.keys.size, 1);
  assert.match(redis.keys.get(`${LOCK_PREFIX}sweep`).value, /^b-/);
  bWork.resolve();
  assert.equal((await bRun).ran, true);
});

test('fn error: the lock is released and the error is thrown', async () => {
  const { a, b } = setup();
  await assert.rejects(a.runOnce('purge', async () => { throw new Error('boom'); }, { ttlMs: 30000 }), /boom/);
  assert.equal((await b.runOnce('purge', async () => {}, { ttlMs: 30000 })).ran, true);
});

test("Redis down: 'skip' skips, 'run' runs without the lock; one warning per outage", async () => {
  const { a, redis, warnings } = setup();
  let runs = 0;
  redis.failNext = 3;
  assert.deepEqual(await a.runOnce('sweep', async () => { runs += 1; }, { ttlMs: 1000 }), { ran: false, reason: 'redis_error' });
  assert.deepEqual(await a.runOnce('purge', async () => { runs += 1; return 'x'; }, { ttlMs: 1000, onRedisError: 'run' }),
    { ran: true, result: 'x', locked: false });
  await a.runOnce('sweep', async () => { runs += 1; }, { ttlMs: 1000 });
  assert.equal(runs, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^\[svc\] job lock sweep: Redis unavailable \(connection refused\), skipping this run/);

  // Redis is back: the job runs and the next outage is reported again.
  await a.runOnce('sweep', async () => { runs += 1; }, { ttlMs: 1000 });
  assert.equal(runs, 2);
  redis.failNext = 1;
  await a.runOnce('sweep', async () => {}, { ttlMs: 1000 });
  assert.equal(warnings.length, 2);
});

test('a failed release is logged and does not hide the result', async () => {
  const { a, redis, warnings } = setup();
  const res = a.runOnce('sweep', async () => { redis.failNext = 1; return 7; }, { ttlMs: 1000 });
  assert.deepEqual(await res, { ran: true, result: 7, locked: true });
  assert.match(warnings[0], /release failed/);
});
