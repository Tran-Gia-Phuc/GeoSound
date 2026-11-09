// =========================================================
// #329 — RedisPresenceStore against an in-memory stand-in for the ioredis commands it uses
// (sorted set, HyperLogLog as an exact set, MULTI/EXEC with [error, result] per command).
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RedisPresenceStore, ONLINE_KEY, DAY_KEY_PREFIX } from '../src/infrastructure/cache/redis-presence-store.js';

const NOW = new Date('2026-11-09T03:00:00Z'); // 10:00 in Vietnam
const SEC = 1000;

// Score bounds as Redis takes them: -inf, +inf, a number, or "(n" for an open bound.
function bound(v) {
  if (v === '-inf') return { n: -Infinity, open: false };
  if (v === '+inf') return { n: Infinity, open: false };
  const s = String(v);
  return s.startsWith('(') ? { n: Number(s.slice(1)), open: true } : { n: Number(s), open: false };
}
const inRange = (score, min, max) =>
  (min.open ? score > min.n : score >= min.n) && (max.open ? score < max.n : score <= max.n);

class FakeRedis {
  constructor() {
    this.zsets = new Map();
    this.hlls = new Map();
    this.ttls = new Map();
    this.failing = false;
  }
  #check() {
    if (this.failing) throw new Error('connect ECONNREFUSED');
  }
  #z(key) {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    return this.zsets.get(key);
  }
  async zadd(key, score, member) {
    this.#check();
    this.#z(key).set(member, Number(score));
    return 1;
  }
  async zrem(key, member) {
    this.#check();
    return this.#z(key).delete(member) ? 1 : 0;
  }
  async zremrangebyscore(key, min, max) {
    this.#check();
    const z = this.#z(key);
    let n = 0;
    for (const [m, s] of z) if (inRange(s, bound(min), bound(max))) (z.delete(m), (n += 1));
    return n;
  }
  async zremrangebyrank(key, start, stop) {
    this.#check();
    const z = this.#z(key);
    const sorted = [...z.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
    const norm = (i) => (i < 0 ? sorted.length + i : i);
    const from = Math.max(0, norm(start));
    const to = Math.min(sorted.length - 1, norm(stop));
    for (let i = from; i <= to; i += 1) z.delete(sorted[i]);
    return Math.max(0, to - from + 1);
  }
  async zcount(key, min, max) {
    this.#check();
    return [...this.#z(key).values()].filter((s) => inRange(s, bound(min), bound(max))).length;
  }
  async zmscore(key, ...members) {
    this.#check();
    const z = this.#z(key);
    return members.map((m) => (z.has(m) ? String(z.get(m)) : null));
  }
  async pfadd(key, member) {
    this.#check();
    if (!this.hlls.has(key)) this.hlls.set(key, new Set());
    this.hlls.get(key).add(member);
    return 1;
  }
  async pfcount(...keys) {
    this.#check();
    const all = new Set();
    for (const k of keys) for (const m of this.hlls.get(k) ?? []) all.add(m);
    return all.size;
  }
  async expire(key, seconds) {
    this.#check();
    this.ttls.set(key, seconds);
    return 1;
  }
  multi() {
    const ops = [];
    const tx = new Proxy(
      {},
      {
        get: (_, name) =>
          name === 'exec'
            ? async () => {
                const out = [];
                for (const [op, args] of ops) {
                  try {
                    out.push([null, await this[op](...args)]);
                  } catch (err) {
                    out.push([err, null]);
                  }
                }
                return out;
              }
            : (...args) => {
                ops.push([name, args]);
                return tx;
              },
      },
    );
    return tx;
  }
}

const store = (redis, opts = {}) =>
  new RedisPresenceStore(redis, { windowSeconds: 120, maxDevices: 100, dayOffsetMinutes: 420, ...opts });
const at = (sec) => new Date(NOW.getTime() + sec * SEC);

test('touch: one entry per device, last seen moves; leave removes it at once', async () => {
  const redis = new FakeRedis();
  const s = store(redis);
  await s.touch('d1', at(0));
  await s.touch('d1', at(60));
  await s.touch('d2', at(60));
  assert.equal(redis.zsets.get(ONLINE_KEY).size, 2);
  assert.equal(redis.zsets.get(ONLINE_KEY).get('d1'), at(60).getTime());
  assert.deepEqual(await s.countOnline(at(0), []), { total: 2, known: 0 });

  await s.leave('d2');
  assert.deepEqual(await s.countOnline(at(0), []), { total: 1, known: 0 });
});

test('touch prunes devices older than the online window and caps the set (oldest out first)', async () => {
  const redis = new FakeRedis();
  await store(redis).touch('old', at(0));
  await store(redis).touch('new', at(121));
  assert.deepEqual([...redis.zsets.get(ONLINE_KEY).keys()], ['new']);

  const capped = new FakeRedis();
  const s = store(capped, { maxDevices: 3 });
  for (let i = 1; i <= 5; i += 1) await s.touch(`d${i}`, at(i));
  assert.deepEqual([...capped.zsets.get(ONLINE_KEY).keys()].sort(), ['d3', 'd4', 'd5']);
});

test('countOnline: total since a time, and how many of the given device ids are among them', async () => {
  const redis = new FakeRedis();
  const s = store(redis);
  await s.touch('guest', at(100));
  await s.touch('signed', at(100));
  await s.touch('stale', at(0));
  const res = await s.countOnline(at(50), ['signed', 'stale', 'unknown']);
  assert.deepEqual(res, { total: 2, known: 1 });
});

test('countActive: distinct devices per local day (UTC+7), several days counted together', async () => {
  const redis = new FakeRedis();
  const s = store(redis);
  // 2026-11-08T18:00Z is already 2026-11-09 in Vietnam: same day as NOW.
  assert.equal(s.dayKey(new Date('2026-11-08T18:00:00Z')), `${DAY_KEY_PREFIX}2026-11-09`);
  assert.equal(s.dayKey(new Date('2026-11-08T16:59:59Z')), `${DAY_KEY_PREFIX}2026-11-08`);

  await s.touch('a', new Date('2026-11-08T18:00:00Z'));
  await s.touch('b', NOW);
  await s.touch('a', at(-3 * 86400)); // 3 days ago
  await s.touch('c', at(-10 * 86400)); // 10 days ago
  assert.deepEqual(await s.countActive(NOW, [1, 7, 30]), [2, 2, 3]);
  // Day keys expire on their own (32 days).
  assert.equal(redis.ttls.get(`${DAY_KEY_PREFIX}2026-11-09`), 32 * 24 * 3600);
});

test('errors: a failed command in MULTI rejects touch; a hanging Redis times out', async () => {
  const redis = new FakeRedis();
  redis.failing = true;
  await assert.rejects(store(redis).touch('d1', NOW), /ECONNREFUSED/);
  await assert.rejects(store(redis).countOnline(NOW, ['d1']), /ECONNREFUSED/);

  const hanging = { zrem: () => new Promise(() => {}) };
  await assert.rejects(store(hanging, { timeoutMs: 20 }).leave('d1'), /timed out/);
});
