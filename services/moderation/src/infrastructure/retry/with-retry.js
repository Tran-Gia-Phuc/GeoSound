// Retry helper (task #AI-34): 3 attempts, delays 2 s then 4 s (baseDelayMs * 2^(attempt-1)).
// Retries only errors accepted by isRetryable; by default an AiTemporaryError that is not a configuration
// error (401). Anything else is thrown at once. After the last attempt the last error is thrown.
import { AiTemporaryError } from '../../domain/errors/index.js';

export const isRetryableAiError = (err) => err instanceof AiTemporaryError && err.kind !== 'config';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @template T
 * @param {(attempt: number) => Promise<T>} fn  called with the attempt number (1-based)
 * @param {{ maxAttempts?: number, baseDelayMs?: number, isRetryable?: (err: unknown) => boolean,
 *           sleep?: (ms: number) => Promise<void> }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, {
  maxAttempts = 3,
  baseDelayMs = 2000,
  isRetryable = isRetryableAiError,
  sleep = defaultSleep,
} = {}) {
  const attempts = Math.max(1, maxAttempts);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) throw err;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
