// Retry sweeper timer (task #AI-38) with injected fake timers: no overlap, errors swallowed, stop clears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRetrySweeper } from '../src/interfaces/jobs/retry-sweeper.js';
import { FakeLogger } from './helpers/fakes.js';

function fakeTimers() {
  const t = { fn: null, ms: null, cleared: [], handle: { id: 'timer-1' } };
  t.setIntervalImpl = (fn, ms) => { t.fn = fn; t.ms = ms; return t.handle; };
  t.clearIntervalImpl = (h) => { t.cleared.push(h); };
  return t;
}

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('schedules execute every intervalMs', async () => {
  const timers = fakeTimers();
  let runs = 0;
  startRetrySweeper({ retryFailedCases: { execute: async () => { runs += 1; } }, intervalMs: 60000, logger: new FakeLogger(), ...timers });
  assert.equal(timers.ms, 60000);
  await timers.fn();
  await timers.fn();
  assert.equal(runs, 2);
});

test('a tick is skipped while the previous sweep is still running (no overlap)', async () => {
  const timers = fakeTimers();
  const pending = [];
  const retryFailedCases = { execute: () => { const d = deferred(); pending.push(d); return d.promise; } };
  startRetrySweeper({ retryFailedCases, intervalMs: 10, logger: new FakeLogger(), ...timers });

  const first = timers.fn();
  await timers.fn(); // previous still running: skipped
  await timers.fn();
  assert.equal(pending.length, 1);

  pending[0].resolve({});
  await first;
  const next = timers.fn();
  assert.equal(pending.length, 2);
  pending[1].resolve({});
  await next;
});

test('errors are logged and swallowed; the next tick runs again', async () => {
  const timers = fakeTimers();
  const logger = new FakeLogger();
  let runs = 0;
  const retryFailedCases = { execute: async () => { runs += 1; if (runs === 1) throw new Error('db down'); return {}; } };
  startRetrySweeper({ retryFailedCases, intervalMs: 10, logger, ...timers });
  await assert.doesNotReject(timers.fn());
  assert.ok(logger.lines.some(([level, m]) => level === 'error' && /db down/.test(m)));
  await timers.fn();
  assert.equal(runs, 2);
});

test('a throwing logger never makes the tick reject', async () => {
  const timers = fakeTimers();
  const logger = { info() {}, error() { throw new Error('logger broken'); } };
  startRetrySweeper({ retryFailedCases: { execute: async () => { throw new Error('x'); } }, intervalMs: 10, logger, ...timers });
  await assert.doesNotReject(timers.fn());
});

test('stop clears the interval and later ticks do nothing', async () => {
  const timers = fakeTimers();
  let runs = 0;
  const sweeper = startRetrySweeper({ retryFailedCases: { execute: async () => { runs += 1; } }, intervalMs: 10, logger: new FakeLogger(), ...timers });
  sweeper.stop();
  assert.deepEqual(timers.cleared, [timers.handle]);
  await timers.fn();
  await sweeper.tick();
  assert.equal(runs, 0);
});

test('default timers: the real interval is unref-ed and stop clears it', () => {
  const sweeper = startRetrySweeper({ retryFailedCases: { execute: async () => ({}) }, intervalMs: 3_600_000, logger: new FakeLogger() });
  sweeper.stop(); // the test process would hang here if the interval were still active
});
