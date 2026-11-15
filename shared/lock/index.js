// =========================================================
// Singleton periodic jobs (deployment plan task 0.8, issue #354).
// Every replica runs the same timers; a Redis lock makes only one of them do the work per interval.
//
//   const lock = createJobLock(redis, { service: 'moderation' });
//   await lock.runOnce('moderation:retry-sweep', () => sweep(), { ttlMs: 30000, holdMs: 48000 });
//
// - Acquire: SET lock:job:<name> <token> NX PX ttlMs. Not acquired = another replica has it: skip
//   quietly (no log line, so the logs show one run per interval).
// - While the job runs, the lock is renewed every ttlMs / 3 (owner only), so a long run never
//   overlaps a run on another replica. If the pod dies, the lock expires after ttlMs.
// - When the job ends, the lock is kept until holdMs after the start (owner only), then expires:
//   at most one run per holdMs across replicas, whatever the phase of their timers. Use holdMs a
//   bit below the interval so the next tick of the same replica finds the lock free.
// - Redis error on acquire: onRedisError 'skip' (default: the job waits for the next tick) or 'run'
//   (run without the lock, for idempotent jobs such as purges). Logged once per outage.
// The Redis client is injected (ioredis: set, eval); shared/ does not depend on ioredis.
// =========================================================
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

export const LOCK_PREFIX = 'lock:job:';

// KEYS[1] lock key, ARGV[1] owner token, ARGV[2] new TTL in ms.
export const RENEW_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0`;

// KEYS[1] lock key, ARGV[1] owner token, ARGV[2] ms to keep the lock (0 = delete now).
export const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then
  local ms = tonumber(ARGV[2])
  if ms > 0 then
    return redis.call('pexpire', KEYS[1], ms)
  end
  return redis.call('del', KEYS[1])
end
return 0`;

/**
 * @param {{ set: Function, eval: Function }} redis ioredis client (or a fake with the same calls)
 * @param {{ service: string, logger?: Pick<Console, 'warn'>, now?: () => number,
 *           setIntervalImpl?: typeof setInterval, clearIntervalImpl?: typeof clearInterval,
 *           newToken?: () => string }} options
 */
export function createJobLock(redis, {
  service,
  logger = console,
  now = Date.now,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  newToken = () => `${hostname()}:${process.pid}:${randomUUID()}`,
} = {}) {
  if (!redis) throw new Error('createJobLock: redis client is required');
  if (!service) throw new Error('createJobLock: service is required');
  let redisDown = false; // one warning per outage

  function warnOnce(message) {
    if (redisDown) return;
    redisDown = true;
    try { logger.warn(`[${service}] ${message}`); } catch { /* never throw */ }
  }

  /**
   * Runs fn on at most one replica per holdMs.
   * @template T
   * @param {string} name lock name, for example 'moderation:retry-sweep'
   * @param {() => Promise<T>} fn
   * @param {{ ttlMs: number, holdMs?: number, onRedisError?: 'skip' | 'run' }} opts
   * @returns {Promise<{ ran: true, result: T, locked: boolean } | { ran: false, reason: 'held' | 'redis_error' }>}
   *   fn's own error is thrown after the lock is released.
   */
  async function runOnce(name, fn, { ttlMs, holdMs = 0, onRedisError = 'skip' } = {}) {
    if (!(ttlMs > 0)) throw new Error('runOnce: ttlMs must be > 0');
    const key = `${LOCK_PREFIX}${name}`;
    const token = newToken();
    const startedAt = now();

    let acquired;
    try {
      acquired = (await redis.set(key, token, 'PX', ttlMs, 'NX')) === 'OK';
      redisDown = false;
    } catch (err) {
      const fallback = onRedisError === 'run' ? 'running it without the lock' : 'skipping this run';
      warnOnce(`job lock ${name}: Redis unavailable (${err?.message ?? err}), ${fallback}`);
      if (onRedisError !== 'run') return { ran: false, reason: 'redis_error' };
      return { ran: true, result: await fn(), locked: false };
    }
    if (!acquired) return { ran: false, reason: 'held' };

    // Keep the lock alive while the job runs; a failed renewal only shortens it.
    const renew = setIntervalImpl(() => {
      Promise.resolve()
        .then(() => redis.eval(RENEW_SCRIPT, 1, key, token, ttlMs))
        .catch((err) => warnOnce(`job lock ${name}: renew failed (${err?.message ?? err})`));
    }, Math.max(1, Math.floor(ttlMs / 3)));
    renew?.unref?.();

    try {
      return { ran: true, result: await fn(), locked: true };
    } finally {
      clearIntervalImpl(renew);
      const keepMs = Math.max(0, Math.ceil(holdMs - (now() - startedAt)));
      try {
        await redis.eval(RELEASE_SCRIPT, 1, key, token, keepMs);
      } catch (err) {
        warnOnce(`job lock ${name}: release failed (${err?.message ?? err}), it expires after ${ttlMs} ms`);
      }
    }
  }

  return { runOnce };
}
