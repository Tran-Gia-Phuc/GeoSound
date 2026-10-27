// Retry helper (task #AI-27): 3 attempts, delays 2 s then 4 s.
// Retry only AiTemporaryError (timeout, 503, 429, network). AiPermanentError is thrown at once.
export async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 2000, sleep } = {}) {
  throw new Error('not implemented: #AI-27');
}
