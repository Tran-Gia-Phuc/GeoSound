// =========================================================
// Impl của port ChallengeStore bằng Redis.
// Mỗi thử thách = 1 key "auth:otp:<kind>:<email>" chứa JSON, tự hết hạn theo TTL.
//   kind='register': { code, fullName, passwordHash, role }
//   kind='reset'   : { code }
// =========================================================

/** @implements {import('../../domain/ports/index.js').ChallengeStore} */
export class RedisChallengeStore {
  /** @param {import('ioredis').Redis} redis */
  constructor(redis) {
    this.redis = redis;
  }

  static key(kind, email) {
    return `auth:otp:${kind}:${email}`;
  }

  async save(kind, email, payload, ttlSeconds) {
    await this.redis.set(RedisChallengeStore.key(kind, email), JSON.stringify(payload), 'EX', ttlSeconds);
  }

  async get(kind, email) {
    const raw = await this.redis.get(RedisChallengeStore.key(kind, email));
    return raw ? JSON.parse(raw) : null;
  }

  async delete(kind, email) {
    await this.redis.del(RedisChallengeStore.key(kind, email));
  }
}
