// =========================================================
// Rate-limit tại gateway bằng Redis (fixed-window đơn giản).
// Nếu Redis chưa sẵn sàng -> cho qua (fail-open) để không chặn dev.
// =========================================================
import Redis from 'ioredis';

const WINDOW_SEC = 60;
const MAX_REQ = 120; // mỗi IP / cửa sổ

let redis = null;
try {
  redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', (e) => console.warn('[gateway] redis:', e.message));
  await redis.connect().catch(() => { redis = null; });
} catch {
  redis = null;
}

export async function rateLimit(req, res, next) {
  if (!redis) return next();
  try {
    const key = `rl:${req.ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WINDOW_SEC);
    if (count > MAX_REQ) return res.status(429).json({ error: 'Too many requests' });
    next();
  } catch {
    next(); // fail-open
  }
}

// Shared Redis client (null while Redis is not ready), used by the chat limiter.
export const getRedis = () => redis;
