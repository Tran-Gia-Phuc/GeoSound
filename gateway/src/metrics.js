// Prometheus metrics of the gateway (deployment phase 4, task 4.2, issue #399).
// The gateway image has no shared/, so this is a small inline version of shared/metrics with the
// same metric names, labels and buckets:
//   http_requests_total{method, route, status}, http_request_duration_seconds{method, route, status}
// plus the default process metrics, all with the constant label service="gateway".
// `route` is the mount prefix the request went to (`/api/tours`, `/api/geocode`, ...), else
// `unmatched`: never the raw URL, so no id, email or query string ends up in a label value.
import client from 'prom-client';

export const HTTP_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const SKIPPED_PATHS = new Set(['/metrics', '/healthz', '/readyz', '/health']);

/** First prefix the path is under (`/api/tours` matches `/api/tours` and `/api/tours/x`), else `unmatched`. */
export function routeLabel(path, prefixes) {
  for (const p of prefixes) if (path === p || path.startsWith(`${p}/`)) return p;
  return 'unmatched';
}

// /api/<anything>/metrics (any case, optional trailing slash): the proxies strip the mount prefix,
// so /api/tours/metrics would reach the /metrics route of a service, which has no auth.
const INTERNAL_METRICS_PATH = /^\/api(?:\/.*)?\/metrics\/?$/i;

/** True when the path (query string ignored, percent-escapes decoded) ends in a `metrics` segment under /api. */
export function isServiceMetricsPath(url) {
  const path = String(url || '').split('?')[0];
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // malformed escape: test the raw path only
  }
  return INTERNAL_METRICS_PATH.test(path) || INTERNAL_METRICS_PATH.test(decoded);
}

/**
 * Middleware: 404 (same body as the gateway's other 404s) for /api/.../metrics, so the services'
 * /metrics stay internal. Register it before the proxies.
 */
export function refuseServiceMetrics(req, res, next) {
  if (isServiceMetricsPath(req.originalUrl || req.url)) return res.status(404).json({ error: 'Not found' });
  next();
}

/**
 * @param {{ prefixes: string[], service?: string, collectDefault?: boolean }} opts
 *   prefixes: the mounted paths, in the order the gateway registers them.
 */
export function createMetrics({ prefixes, service = 'gateway', collectDefault = true }) {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service });
  if (collectDefault) client.collectDefaultMetrics({ register: registry });
  const labelNames = ['method', 'route', 'status'];
  const requests = new client.Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled, by method, route prefix and status',
    labelNames,
    registers: [registry],
  });
  const duration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route prefix and status',
    labelNames,
    buckets: HTTP_DURATION_BUCKETS,
    registers: [registry],
  });

  /** Counts every finished request; register it before the rate limit and the proxies. */
  function httpMiddleware() {
    return function metricsMiddleware(req, res, next) {
      const path = String(req.originalUrl || req.url || '').split('?')[0];
      if (SKIPPED_PATHS.has(path)) return next();
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const labels = { method: req.method, route: routeLabel(path, prefixes), status: String(res.statusCode) };
        requests.inc(labels);
        duration.observe(labels, Number(process.hrtime.bigint() - start) / 1e9);
      });
      next();
    };
  }

  /**
   * GET /metrics (no auth). Internal: Traefik routes only /api to the gateway, and the gateway
   * refuses /api/.../metrics (refuseServiceMetrics).
   */
  function registerMetricsRoute(app) {
    app.get('/metrics', async (_req, res) => {
      try {
        const body = await registry.metrics();
        res.set('Content-Type', registry.contentType);
        res.end(body);
      } catch {
        res.status(500).end();
      }
    });
  }

  return { registry, httpMiddleware, registerMetricsRoute };
}
