// Tests for shared/metrics (task 4.2, issue #399): route labels, skipped paths, /metrics output.
// A real express app on 127.0.0.1 with an ephemeral port; no other network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMetrics } from '../metrics/index.js';

const servers = [];
after(() => servers.forEach((s) => (s.closeAllConnections(), s.close())));

function listen(app) {
  return new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`));
    servers.push(srv);
  });
}

/** App laid out like a service: json, metrics, health + /metrics, nested routers, 404, errors. */
async function service() {
  const metrics = createMetrics({ service: 'tour' });
  const app = express();
  app.use(express.json());
  app.use(metrics.httpMiddleware());
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', (_req, res) => res.json({ status: 'ready' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  metrics.registerMetricsRoute(app);

  const tours = express.Router();
  tours.get('/:id', (req, res) => res.json({ id: req.params.id }));
  tours.post('/:id/fail', () => {
    throw new Error('boom');
  });
  const admin = express.Router();
  const reviews = express.Router();
  reviews.get('/:tourId', (_req, res) => res.status(204).end());
  admin.use('/reviews', reviews);
  app.use('/api/tours', tours);
  app.use('/admin', admin);
  app.get('/', (_req, res) => res.json([]));

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((_err, _req, res, _next) => res.status(500).json({ error: 'Internal' }));
  const url = await listen(app);
  const scrape = async () => {
    const res = await fetch(`${url}/metrics`);
    return { res, text: await res.text() };
  };
  return { url, scrape };
}

const countLine = (text, labels) =>
  text.split('\n').find((l) => l.startsWith('http_requests_total{') && labels.every((x) => l.includes(x)));

/** Value of the sample `name` whose labels are exactly `labels` (any order), else undefined. */
function sample(text, name, labels) {
  const want = JSON.stringify(Object.entries(labels).sort());
  for (const line of text.split('\n')) {
    const m = line.match(/^([a-zA-Z_:][\w:]*)(?:\{(.*)\})? (\S+)$/);
    if (!m || m[1] !== name) continue;
    const got = [...(m[2] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]).sort();
    if (JSON.stringify(got) === want) return Number(m[3]);
  }
  return undefined;
}

test('a matched route gives the pattern, never the id or the query string', async () => {
  const { url, scrape } = await service();
  await fetch(`${url}/api/tours/3f2a6c1e-0000-4000-8000-000000000001?email=a%40b.c&token=secret`);
  await fetch(`${url}/api/tours/42`);
  const { text } = await scrape();
  const line = countLine(text, ['route="/api/tours/:id"', 'method="GET"', 'status="200"']);
  assert.ok(line, text);
  assert.match(line, / 2$/);
  assert.match(line, /service="tour"/);
  assert.doesNotMatch(text, /3f2a6c1e|email|secret|route="\/api\/tours\/42"/);
  const labels = { method: 'GET', route: '/api/tours/:id', status: '200', service: 'tour' };
  assert.equal(sample(text, 'http_request_duration_seconds_bucket', { le: '5', ...labels }), 2);
  assert.equal(sample(text, 'http_request_duration_seconds_count', labels), 2);
  // The buckets of the frozen interface.
  const les = [...text.matchAll(/^http_request_duration_seconds_bucket\{[^}]*le="([^"]+)"/gm)].map((x) => x[1]);
  assert.deepEqual([...new Set(les)], ['0.05', '0.1', '0.25', '0.5', '1', '2.5', '5', '+Inf']);
});

test('nested routers keep the full mount path, also on an error', async () => {
  const { url, scrape } = await service();
  await fetch(`${url}/admin/reviews/abc`);
  await fetch(`${url}/api/tours/9/fail`, { method: 'POST' });
  await fetch(`${url}/`);
  const { text } = await scrape();
  assert.ok(countLine(text, ['route="/admin/reviews/:tourId"', 'status="204"']), text);
  assert.ok(countLine(text, ['method="POST"', 'route="/api/tours/:id/fail"', 'status="500"']), text);
  assert.ok(countLine(text, ['route="/"', 'status="200"']), text);
});

test('an unknown path is counted as unmatched', async () => {
  const { url, scrape } = await service();
  await fetch(`${url}/nope/123?x=1`);
  await fetch(`${url}/api/tours`); // router mounted, no route matches
  const { text } = await scrape();
  const line = countLine(text, ['route="unmatched"', 'status="404"']);
  assert.ok(line, text);
  assert.match(line, / 2$/);
  assert.doesNotMatch(text, /nope|x=1/);
});

test('/metrics, /healthz, /readyz and /health are not counted', async () => {
  const { url, scrape } = await service();
  for (const p of ['/healthz', '/readyz', '/health', '/metrics', '/healthz?probe=1']) await fetch(url + p);
  await scrape();
  const { text } = await scrape();
  assert.doesNotMatch(text, /^http_requests_total\{/m);
  assert.match(text, /# TYPE http_requests_total counter/);
});

test('/metrics answers the text format with the default process metrics', async () => {
  const { url, scrape } = await service();
  await fetch(`${url}/api/tours/1`);
  const { res, text } = await scrape();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain; version=0\.0\.4/);
  assert.match(text, /^process_cpu_user_seconds_total\{service="tour"\} /m);
  assert.match(text, /^nodejs_heap_size_used_bytes\{service="tour"\} /m);
  assert.match(text, /# TYPE http_request_duration_seconds histogram/);
});

test('collectDefault: false leaves the process metrics out; each call has its own registry', async () => {
  const a = createMetrics({ service: 'a', collectDefault: false });
  const b = createMetrics({ service: 'b', collectDefault: false });
  a.counter({ name: 'x_total', help: 'x' }).inc();
  const textA = await a.registry.metrics();
  const textB = await b.registry.metrics();
  assert.doesNotMatch(textA, /process_cpu/);
  assert.match(textA, /^x_total\{service="a"\} 1$/m);
  assert.doesNotMatch(textB, /x_total/);
  assert.throws(() => createMetrics({}), /service is required/);
});

test('counter, histogram and gauge wrappers, with and without labels', async () => {
  const m = createMetrics({ service: 'svc', collectDefault: false });
  const c = m.counter({ name: 'jobs_total', help: 'jobs', labelNames: ['result'] });
  c.inc({ result: 'ok' });
  c.inc({ result: 'ok' }, 2);
  // Same name again: the registered metric is reused, not a second one.
  m.counter({ name: 'jobs_total', help: 'jobs', labelNames: ['result'] }).inc({ result: 'ok' });
  const plain = m.counter({ name: 'ticks_total', help: 'ticks' });
  plain.inc();
  plain.inc(undefined, 4);

  const h = m.histogram({ name: 'job_seconds', help: 'job', labelNames: ['kind'], buckets: [1, 2] });
  h.observe({ kind: 'a' }, 1.5);
  const end = h.startTimer({ kind: 'b' });
  assert.equal(typeof end(), 'number');
  m.histogram({ name: 'raw_seconds', help: 'raw' }).observe({}, 0.3);

  const g = m.gauge({ name: 'queue_depth', help: 'depth', labelNames: ['queue'] });
  g.set({ queue: 'q' }, 5);
  g.inc({ queue: 'q' });
  g.dec({ queue: 'q' });
  g.dec({ queue: 'q' });
  const lone = m.gauge({ name: 'busy', help: 'busy' });
  lone.set({}, 1);
  lone.inc();

  const text = await m.registry.metrics();
  const svc = { service: 'svc' };
  assert.equal(sample(text, 'jobs_total', { result: 'ok', ...svc }), 4);
  assert.equal(sample(text, 'ticks_total', svc), 5);
  assert.equal(sample(text, 'job_seconds_bucket', { le: '1', kind: 'a', ...svc }), 0);
  assert.equal(sample(text, 'job_seconds_bucket', { le: '2', kind: 'a', ...svc }), 1);
  assert.equal(sample(text, 'job_seconds_count', { kind: 'b', ...svc }), 1);
  assert.equal(sample(text, 'raw_seconds_sum', svc), 0.3);
  assert.equal(sample(text, 'queue_depth', { queue: 'q', ...svc }), 4);
  assert.equal(sample(text, 'busy', svc), 2);
});

test('rabbitmq useMetrics() with the real factories registers the event counters once', async () => {
  const m = createMetrics({ service: 'tour', collectDefault: false });
  const r = await import('../rabbitmq/index.js?metrics=1');
  r.useMetrics(m);
  r.useMetrics(m); // a second call reuses the registered counters
  const text = await m.registry.metrics();
  assert.match(text, /# TYPE events_published_total counter/);
  assert.match(text, /# TYPE events_consumed_total counter/);
});
