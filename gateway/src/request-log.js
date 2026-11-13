// Structured request logs at the gateway (deployment plan task 0.9, #355).
// Same JSON line as shared/middleware/request-log.js (the gateway image has no shared/):
//   {"time","level","service":"gateway","msg":"request","reqId","method","path","status","durationMs"}
// The gateway is the public edge: it always creates a new x-request-id (an incoming one is
// replaced), puts it on the request so http-proxy-middleware forwards it to every service and to
// the chat route, and echoes it to the client (useful in bug reports).
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';
const PROBE_PATHS = new Set(['/healthz', '/readyz', '/health']);

export function levelFor(status) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

/** One JSON line; error -> stderr, the rest -> stdout. */
export function logJson(level, msg, fields = {}, { write } = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, service: 'gateway', msg, ...fields });
  if (write) write(line);
  else if (level === 'error') console.error(line);
  else console.log(line);
}

/** @param {{ write?: (line: string) => void, newId?: () => string }} [opts] */
export function createRequestLogger({ write, newId = randomUUID } = {}) {
  return function requestLogger(req, res, next) {
    const start = process.hrtime.bigint();
    const id = newId();
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
      }, { write });
    };
    res.on('finish', finish);
    res.on('close', finish);
    next();
  };
}
