// Health and readiness routes shared by every Node service (deployment plan task 0.4, issue #345).
//
//   GET /healthz  liveness: the process answers, no I/O.
//   GET /health   alias of /healthz (kept for compose, the gateway and old scripts).
//   GET /readyz   readiness: runs every check in parallel, each with a timeout.
//                 503 when a *required* check is down; checks that are not required are only
//                 reported, so a fail-open dependency (Redis for the revocation check) does not
//                 take every pod out of the load balancer.
//
// The body never carries error text; the first failure of a check after a success is logged.
// No express import: the routes are registered on the app the service passes in.

export const DEFAULT_CHECK_TIMEOUT_MS = 2000;

/**
 * Runs one check. A check passes when it resolves to anything but `false`; it fails when it
 * resolves to `false`, throws, or does not settle within `timeoutMs`.
 */
export async function runCheck(check, timeoutMs = DEFAULT_CHECK_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    const result = await Promise.race([Promise.resolve().then(check), timeout]);
    return result !== false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Evaluates every check. `checks` = { name: { check: () => any, required?: boolean } }
 * (`required` defaults to true). Returns { ready, checks: { name: 'ok' | 'down' }, failed: [names] }.
 */
export async function evaluateReadiness(checks = {}, { timeoutMs = DEFAULT_CHECK_TIMEOUT_MS } = {}) {
  const entries = Object.entries(checks);
  const results = await Promise.all(entries.map(([, c]) => runCheck(c.check, timeoutMs)));
  const out = {};
  const failed = [];
  let ready = true;
  entries.forEach(([name, c], i) => {
    out[name] = results[i] ? 'ok' : 'down';
    if (!results[i]) {
      failed.push(name);
      if (c.required !== false) ready = false;
    }
  });
  return { ready, checks: out, failed };
}

/**
 * Registers /healthz, /health and /readyz on an express app.
 * `extra` (object or function returning one) is merged into the liveness body,
 * for example `{ storage: 'LocalDiskStorage' }` in media.
 */
export function registerHealthRoutes(app, { service, checks = {}, extra, timeoutMs, log = console } = {}) {
  if (!service) throw new Error('registerHealthRoutes: service is required');
  const liveness = (_req, res) => {
    const more = typeof extra === 'function' ? extra() : extra;
    res.json({ status: 'ok', service, ...(more || {}) });
  };
  app.get('/healthz', liveness);
  app.get('/health', liveness);

  // Log a check when it goes down and when it comes back, not on every probe.
  const down = new Set();
  app.get('/readyz', async (_req, res) => {
    const result = await evaluateReadiness(checks, { timeoutMs });
    for (const name of Object.keys(result.checks)) {
      const isDown = result.checks[name] === 'down';
      if (isDown && !down.has(name)) {
        down.add(name);
        log.warn?.(`[${service}] readiness: ${name} is down`);
      } else if (!isDown && down.has(name)) {
        down.delete(name);
        log.log?.(`[${service}] readiness: ${name} is back`);
      }
    }
    res.status(result.ready ? 200 : 503).json({
      status: result.ready ? 'ready' : 'not_ready',
      service,
      checks: result.checks,
    });
  });
}

/** Check for a Prisma client: `SELECT 1`. */
export const prismaCheck = (prisma) => () => prisma.$queryRaw`SELECT 1`;

/** Check for an ioredis client: `PING` must answer `PONG`. Fails at once while disconnected. */
export const redisCheck = (getRedis) => async () => {
  const redis = typeof getRedis === 'function' ? getRedis() : getRedis;
  if (!redis || redis.status !== 'ready') return false;
  return (await redis.ping()) === 'PONG';
};
