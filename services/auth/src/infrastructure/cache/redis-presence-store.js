// =========================================================
// #329 — impl of the PresenceStore port with Redis: every visitor, signed in or not, by device id.
//   presence:online           sorted set, member = deviceId, score = last seen (ms). Members older
//                             than the online window are pruned on each write; the set is capped
//                             (oldest dropped first) so fake ids cannot grow it without limit.
//   presence:day:<YYYY-MM-DD> HyperLogLog of the devices seen that day (local day, see dayOffsetMinutes),
//                             kept `dayTtlDays`; several days are counted together with PFCOUNT.
// Every call is bounded: with Redis down, ioredis queues commands and would hang the request.
// =========================================================

export const ONLINE_KEY = 'presence:online';
export const DAY_KEY_PREFIX = 'presence:day:';

const DAY_MS = 24 * 60 * 60 * 1000;

/** @implements {import('../../domain/ports/index.js').PresenceStore} */
export class RedisPresenceStore {
  /**
   * @param {import('ioredis').Redis} redis
   * @param {{ windowSeconds: number, maxDevices: number, dayOffsetMinutes?: number, dayTtlDays?: number, timeoutMs?: number }} opts
   */
  constructor(redis, { windowSeconds, maxDevices, dayOffsetMinutes = 0, dayTtlDays = 32, timeoutMs = 1000 }) {
    this.redis = redis;
    this.windowMs = windowSeconds * 1000;
    this.maxDevices = maxDevices;
    this.dayOffsetMs = dayOffsetMinutes * 60 * 1000;
    this.dayTtlSeconds = dayTtlDays * 24 * 60 * 60;
    this.timeoutMs = timeoutMs;
  }

  /** Day key of `at` in local time (offset from UTC), e.g. presence:day:2026-11-09. */
  dayKey(at, daysBack = 0) {
    const day = new Date(at.getTime() + this.dayOffsetMs - daysBack * DAY_MS).toISOString().slice(0, 10);
    return `${DAY_KEY_PREFIX}${day}`;
  }

  async touch(deviceId, now) {
    const ms = now.getTime();
    const day = this.dayKey(now);
    const results = await this.#bounded(() =>
      this.redis
        .multi()
        .zadd(ONLINE_KEY, ms, deviceId)
        .zremrangebyscore(ONLINE_KEY, '-inf', `(${ms - this.windowMs}`)
        .zremrangebyrank(ONLINE_KEY, 0, -(this.maxDevices + 1))
        .pfadd(day, deviceId)
        .expire(day, this.dayTtlSeconds)
        .exec(),
    );
    // exec() resolves with [error, result] per command: surface the first error.
    const failed = (results ?? []).find(([err]) => err);
    if (failed) throw failed[0];
  }

  async leave(deviceId) {
    await this.#bounded(() => this.redis.zrem(ONLINE_KEY, deviceId));
  }

  async countOnline(since, knownDeviceIds) {
    const min = since.getTime();
    return this.#bounded(async () => {
      const total = Number(await this.redis.zcount(ONLINE_KEY, min, '+inf'));
      if (!knownDeviceIds.length) return { total, known: 0 };
      const scores = await this.redis.zmscore(ONLINE_KEY, ...knownDeviceIds);
      const known = scores.filter((s) => s !== null && Number(s) >= min).length;
      return { total, known };
    });
  }

  async countActive(now, days) {
    return this.#bounded(() =>
      Promise.all(
        days.map((n) => {
          const keys = Array.from({ length: n }, (_, i) => this.dayKey(now, i));
          return this.redis.pfcount(...keys).then(Number);
        }),
      ),
    );
  }

  async #bounded(run) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('redis presence call timed out')), this.timeoutMs);
    });
    try {
      return await Promise.race([run(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
