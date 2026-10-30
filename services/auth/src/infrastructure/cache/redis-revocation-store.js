// =========================================================
// UC23 / design 5.3 — impl of the RevocationStore port with Redis.
// Key "revoked:sid:<sid>" = "1", TTL = access token lifetime: after that the access token
// has expired anyway. shared/middleware verifyJwt reads the same key.
// =========================================================

export const REVOKED_SID_PREFIX = 'revoked:sid:';

/** @implements {import('../../domain/ports/index.js').RevocationStore} */
export class RedisRevocationStore {
  /** @param {import('ioredis').Redis} redis @param {{ ttlSeconds: number, timeoutMs?: number }} opts */
  constructor(redis, { ttlSeconds, timeoutMs = 1000 }) {
    this.redis = redis;
    this.ttlSeconds = ttlSeconds;
    this.timeoutMs = timeoutMs;
  }

  static key(sid) {
    return `${REVOKED_SID_PREFIX}${sid}`;
  }

  // Bounded: with Redis down, ioredis queues the command and retries, which would hang a sign-out.
  // The session row is already revoked; only the immediate effect on live access tokens is lost.
  async markRevoked(sid) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('redis revocation write timed out')), this.timeoutMs);
    });
    try {
      await Promise.race([this.redis.set(RedisRevocationStore.key(sid), '1', 'EX', this.ttlSeconds), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
