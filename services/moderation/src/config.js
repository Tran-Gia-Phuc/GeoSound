// Moderation config. Reads env once; no secrets are logged.
import { DEFAULT_GEO_LIMITS } from './domain/geo/tour-geo-rules.js';

const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));
// Positive float or the default (empty, non-numeric or <= 0 values fall back).
const float = (v, d) => {
  if (v === undefined || v === '') return d;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const D = DEFAULT_GEO_LIMITS;
const perType = (env, prefix, defaults) => Object.freeze({
  walking: float(env[`${prefix}_WALKING`], defaults.walking),
  cycling: float(env[`${prefix}_CYCLING`], defaults.cycling),
  driving: float(env[`${prefix}_DRIVING`], defaults.driving),
});

// Same structure as DEFAULT_GEO_LIMITS; speed, dwell and the strong multiplier are not configurable.
function loadGeo(env) {
  return Object.freeze({
    legMaxM: perType(env, 'GEO_LEG_MAX_M', D.legMaxM),
    spreadMaxM: perType(env, 'GEO_SPREAD_MAX_M', D.spreadMaxM),
    speedKmh: D.speedKmh,
    dwellMinutesPerStop: D.dwellMinutesPerStop,
    duplicateMinM: float(env.GEO_DUPLICATE_MIN_M, D.duplicateMinM),
    durationFactor: float(env.GEO_DURATION_FACTOR, D.durationFactor),
    zigzagFactor: float(env.GEO_ZIGZAG_FACTOR, D.zigzagFactor),
    longLegStrongMultiplier: D.longLegStrongMultiplier,
  });
}

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
      // Stale pending/reviewing and unpublished results; defaults to RETRY_FAILED_AFTER_MS (task #AI-38).
      // Must exceed the worst-case review time (AI_MAX_ATTEMPTS x AI_TIMEOUT_MS + backoff), or the sweeper may retry a case that is still being reviewed.
      staleAfterMs: int(env.RETRY_STALE_AFTER_MS, int(env.RETRY_FAILED_AFTER_MS, 300000)),
      batchSize: int(env.RETRY_SWEEP_BATCH_SIZE, 10),
    }),
    geo: loadGeo(env),
  });
}
