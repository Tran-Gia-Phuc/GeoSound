// Structured request logs (deployment plan task 0.9, #355).
// One JSON line per finished request, so Loki can run `{service="tour"} | json | status >= 500`:
//   {"time","level","service","msg","reqId","method","path","status","durationMs"}
// The gateway creates `x-request-id` and forwards it; a service reuses it so one request can be
// followed from the gateway to the service. The gateway has the same code inline
// (gateway/src/request-log.js) because its image has no shared/.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;
const PROBE_PATHS = new Set(['/healthz', '/readyz', '/health']);

let cachedService;

/**
 * Service name for the `service` field: SERVICE_NAME, else the `name` of package.json in the
 * working directory without its scope (`@geosound/tour` -> `tour`), else `unknown`.
 * Services start from their own folder (/app in the image), so no src/index.js has to pass it.
 */
export function serviceName() {
  if (cachedService) return cachedService;
  let name = process.env.SERVICE_NAME;
  if (!name) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
      name = String(pkg.name || '').replace(/^@[^/]+\//, '');
    } catch {
      name = '';
    }
  }
  cachedService = name || 'unknown';
  return cachedService;
}

/** Test helper: forget the cached service name. */
export function resetServiceName() {
  cachedService = undefined;
}

/** The incoming request id when it is safe to log and forward, else a new UUID. */
export function requestIdFrom(value) {
  const id = Array.isArray(value) ? value[0] : value;
  return typeof id === 'string' && SAFE_REQUEST_ID.test(id) ? id : randomUUID();
}

export function levelFor(status) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

/**
 * Writes one JSON line: `time`, `level`, `service`, `msg` first, then `fields`.
 * error -> stderr, everything else -> stdout (both end up in the container log).
 */
export function logJson(level, msg, fields = {}, { service = serviceName(), write } = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, service, msg, ...fields });
  if (write) write(line);
  else if (level === 'error') console.error(line);
  else console.log(line);
}

/**
 * Express middleware factory. Sets `req.id`, echoes `x-request-id` and logs the request when the
 * response finishes (or the client goes away). Successful health probes are not logged.
 * @param {{ service?: string, newId?: boolean, write?: (line: string) => void }} [opts]
 *   newId: always create a new id (the gateway is the public edge and ignores the incoming one).
 */
export function createRequestLogger({ service, newId = false, write } = {}) {
  return function requestLogger(req, res, next) {
    const start = process.hrtime.bigint();
    const id = newId ? randomUUID() : requestIdFrom(req.headers[REQUEST_ID_HEADER]);
    req.id = id;
    req.headers[REQUEST_ID_HEADER] = id;
    res.setHeader(REQUEST_ID_HEADER, id);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // Query strings can carry tokens or personal data: log the path only.
      const urlPath = String(req.originalUrl || req.url || '').split('?')[0];
      const status = res.headersSent || res.writableEnded ? res.statusCode : 499;
      if (status < 400 && PROBE_PATHS.has(urlPath)) return;
      const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
      logJson(levelFor(status), 'request', {
        reqId: id, method: req.method, path: urlPath, status, durationMs,
      }, { service: service ?? serviceName(), write });
    };
    res.on('finish', finish);
    res.on('close', finish);
    next();
  };
}
