// =========================================================
// Chat rate limit (issue #188): per client IP, fixed windows of one minute
// and one day. JWT checks are skipped for now (decision 2026-10-28), so the
// key is the IP. Applied only to the chat routes; the global limiter in
// rate-limit.js is unchanged. If the store fails, requests pass (fail-open)
// with a log line, like rate-limit.js.
// =========================================================

const MINUTE_SEC = 60;
const DAY_SEC = 24 * 60 * 60;
const LOG_EVERY_MS = 60 * 1000;

/**
 * Redis store. `getRedis` returns the shared ioredis client or null when Redis
 * is not available.
 * @param {() => import('ioredis').Redis | null} getRedis
 */
export function createRedisStore(getRedis) {
  return {
    async hit(key, windowSec) {
      const redis = getRedis();
      if (!redis) throw new Error('redis unavailable');
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);
      let ttl = await redis.ttl(key);
      if (ttl < 0) {
        // Key without expiry (lost expire call): set it again.
        await redis.expire(key, windowSec);
        ttl = windowSec;
      }
      return { count, ttl };
    },
  };
}

/** In-memory store with the same interface, for tests and local runs. */
export function createMemoryStore({ now = Date.now } = {}) {
  const keys = new Map(); // key -> { count, resetAt }
  return {
    async hit(key, windowSec) {
      const t = now();
      let e = keys.get(key);
      if (!e || e.resetAt <= t) {
        e = { count: 0, resetAt: t + windowSec * 1000 };
        keys.set(key, e);
      }
      e.count += 1;
      return { count: e.count, ttl: Math.max(1, Math.ceil((e.resetAt - t) / 1000)) };
    },
  };
}

/**
 * Express middleware: CHAT_RATE_LIMIT_PER_MIN and CHAT_RATE_LIMIT_PER_DAY per IP.
 * Over the limit -> 429, `Retry-After` (seconds) and JSON `{ error }`.
 * @param {{ store: { hit(key: string, windowSec: number): Promise<{count: number, ttl: number}> },
 *           perMin?: number, perDay?: number, log?: (msg: string) => void, now?: () => number }} opts
 */
export function createChatRateLimit({ store, perMin = 5, perDay = 100, log = console.warn, now = Date.now }) {
  let lastLogAt = -Infinity;

  return async function chatRateLimit(req, res, next) {
    const ip = req.ip || 'unknown';
    let minute;
    let day;
    try {
      minute = await store.hit(`rl:chat:min:${ip}`, MINUTE_SEC);
      if (minute.count <= perMin) day = await store.hit(`rl:chat:day:${ip}`, DAY_SEC);
    } catch (e) {
      if (now() - lastLogAt >= LOG_EVERY_MS) {
        lastLogAt = now();
        log(`[gateway] chat rate limit skipped (fail-open): ${e.message}`);
      }
      return next();
    }
    const over = minute.count > perMin ? minute : day.count > perDay ? day : null;
    if (over) {
      res.set('Retry-After', String(over.ttl));
      return res.status(429).json({ error: 'Too many chat requests' });
    }
    next();
  };
}
