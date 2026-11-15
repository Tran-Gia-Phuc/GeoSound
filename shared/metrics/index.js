// Prometheus metrics for the Node services (deployment phase 4, task 4.2, issue #399).
//
//   const metrics = createMetrics({ service: 'tour' });
//   app.use(metrics.httpMiddleware());   // right after express.json()
//   metrics.registerMetricsRoute(app);   // GET /metrics, next to the health routes
//
// One registry per call (never prom-client's global one), so tests and several apps in one
// process never share counters. `service` is a constant label on every metric.
// HTTP labels are bounded: `route` is the Express route pattern (`/admin/reviews/:id`), never the
// raw URL, so no id, email or query string ends up in a label value.
// Code outside src/index.js gets the counter / histogram / gauge factories injected (CI rule).
import client from 'prom-client';

export const HTTP_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
export const UNMATCHED_ROUTE = 'unmatched';
const SKIPPED_PATHS = new Set(['/metrics', '/healthz', '/readyz', '/health']);

const hasLabels = (labels) => labels && Object.keys(labels).length > 0;

/** Path of the request without the query string. */
function pathOf(req) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

/** Route pattern of an Express route (a string; arrays and regexps are rendered as text). */
function patternOf(route) {
  const p = route?.path;
  if (typeof p === 'string') return p;
  if (Array.isArray(p)) return p.map(String).join(',');
  return p === undefined ? '' : String(p);
}

/**
 * Creates a registry with the default process metrics (unless `collectDefault` is false) and
 * returns the metric factories, the HTTP middleware and the /metrics route.
 */
export function createMetrics({ service, collectDefault = true } = {}) {
  if (!service) throw new Error('createMetrics: service is required');
  const registry = new client.Registry();
  registry.setDefaultLabels({ service });
  if (collectDefault) client.collectDefaultMetrics({ register: registry });

  // A second call with the same name returns the metric already registered.
  const getOrCreate = (Type, config) =>
    registry.getSingleMetric(config.name) ?? new Type({ ...config, registers: [registry] });

  function counter({ name, help, labelNames = [] }) {
    const c = getOrCreate(client.Counter, { name, help, labelNames });
    return {
      inc(labels, n = 1) {
        if (hasLabels(labels)) c.inc(labels, n);
        else c.inc(n);
      },
    };
  }

  function histogram({ name, help, labelNames = [], buckets }) {
    const h = getOrCreate(client.Histogram, { name, help, labelNames, ...(buckets ? { buckets } : {}) });
    return {
      observe(labels, seconds) {
        if (hasLabels(labels)) h.observe(labels, seconds);
        else h.observe(seconds);
      },
      /** Returns `end(extraLabels?)`, which records the elapsed seconds and returns them. */
      startTimer(labels) {
        return hasLabels(labels) ? h.startTimer(labels) : h.startTimer();
      },
    };
  }

  function gauge({ name, help, labelNames = [] }) {
    const g = getOrCreate(client.Gauge, { name, help, labelNames });
    return {
      set(labels, v) {
        if (hasLabels(labels)) g.set(labels, v);
        else g.set(v);
      },
      inc(labels) {
        if (hasLabels(labels)) g.inc(labels);
        else g.inc();
      },
      dec(labels) {
        if (hasLabels(labels)) g.dec(labels);
        else g.dec();
      },
    };
  }

  const httpRequests = counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled, by method, route pattern and status',
    labelNames: ['method', 'route', 'status'],
  });
  const httpDuration = histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route pattern and status',
    labelNames: ['method', 'route', 'status'],
    buckets: HTTP_DURATION_BUCKETS,
  });

  /**
   * Express middleware: one count and one duration per finished request.
   * `route` = req.baseUrl + req.route.path, else `unmatched`. The base URL is taken when Express
   * assigns `req.route` (the matched route): when an error leaves a nested router, Express resets
   * `req.baseUrl` to the parent's before the response is sent, so reading it at finish time would
   * drop the mount path.
   * Router mounts must be static paths: `req.baseUrl` is the real matched URL, so a mount like
   * app.use('/x/:id', router) would put ids into the `route` label (unbounded cardinality).
   */
  function httpMiddleware() {
    return function metricsMiddleware(req, res, next) {
      if (SKIPPED_PATHS.has(pathOf(req))) return next();
      const start = process.hrtime.bigint();
      let route;
      let routeBase = '';
      Object.defineProperty(req, 'route', {
        configurable: true,
        enumerable: true,
        get: () => route,
        set(value) {
          route = value;
          routeBase = req.baseUrl || '';
        },
      });
      res.on('finish', () => {
        const labels = {
          method: req.method,
          route: route ? routeBase + patternOf(route) || '/' : UNMATCHED_ROUTE,
          status: String(res.statusCode),
        };
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        httpRequests.inc(labels);
        httpDuration.observe(labels, seconds);
      });
      next();
    };
  }

  /** GET /metrics in the Prometheus text format, no auth (never exposed by the ingress). */
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

  return { registry, counter, histogram, gauge, httpMiddleware, registerMetricsRoute };
}
