// Moderation config. Reads env once; no secrets are logged.
const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

export function loadConfig(env = process.env) {
  return Object.freeze({
    port: int(env.PORT, 3003),
    ai: Object.freeze({
      baseUrl: (env.AI_SERVICE_URL ?? 'http://ai:3004').replace(/\/+$/, ''),
      timeoutMs: int(env.AI_TIMEOUT_MS, 45000),
      maxAttempts: int(env.AI_MAX_ATTEMPTS, 3),
      retryDelayMs: int(env.AI_RETRY_DELAY_MS, 2000),
      internalToken: env.INTERNAL_SERVICE_TOKEN ?? '',
    }),
    prefetch: int(env.MODERATION_PREFETCH, 2),
    sweep: Object.freeze({
      intervalMs: int(env.RETRY_SWEEP_INTERVAL_MS, 60000),
      failedAfterMs: int(env.RETRY_FAILED_AFTER_MS, 300000),
    }),
  });
}
