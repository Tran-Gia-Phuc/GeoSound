// Retry helper (task #AI-34): 3 attempts, 2 s then 4 s, only temporary errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../src/infrastructure/retry/with-retry.js';
import { AiTemporaryError, AiPermanentError } from '../src/domain/errors/index.js';

const recorder = () => {
  const delays = [];
  return { delays, sleep: async (ms) => { delays.push(ms); } };
};

test('returns at once when the first attempt succeeds', async () => {
  const { delays, sleep } = recorder();
  assert.equal(await withRetry(async () => 'ok', { sleep }), 'ok');
  assert.deepEqual(delays, []);
});

test('succeeds on the 2nd attempt after one 2 s wait', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const out = await withRetry(async (attempt) => {
    calls += 1;
    assert.equal(attempt, calls);
    if (calls === 1) throw new AiTemporaryError('503', { status: 503 });
    return 'ok';
  }, { sleep });
  assert.equal(out, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
});

test('exhausts after 3 attempts with waits 2000 then 4000 and throws the last error', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls += 1; throw new AiTemporaryError(`fail ${calls}`, { kind: 'timeout' }); }, { sleep }),
    (err) => err instanceof AiTemporaryError && err.message === 'fail 3',
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test('a permanent error is thrown at once', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls += 1; throw new AiPermanentError('422', { status: 422, kind: 'invalid_input' }); }, { sleep }),
    AiPermanentError,
  );
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test('a configuration error (401) is not retried', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls += 1; throw new AiTemporaryError('401', { status: 401, kind: 'config' }); }, { sleep }),
    (err) => err.kind === 'config',
  );
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test('an unknown error is not retried by default', async () => {
  const { sleep } = recorder();
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw new TypeError('bug'); }, { sleep }), TypeError);
  assert.equal(calls, 1);
});

test('maxAttempts, baseDelayMs and isRetryable are configurable', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw new Error('x'); }, {
    maxAttempts: 4, baseDelayMs: 10, isRetryable: () => true, sleep,
  }));
  assert.equal(calls, 4);
  assert.deepEqual(delays, [10, 20, 40]);
});
