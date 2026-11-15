// Gateway metrics tests (task 4.2, issue #399): the route label is the mount prefix or
// `unmatched`, proxied answers are counted, probes and /metrics are not.
// Fake upstream on 127.0.0.1 with an ephemeral port, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createMetrics, routeLabel } from '../src/metrics.js';

const servers = [];
after(() => servers.forEach((s) => (s.closeAllConnections(), s.close())));

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`));
  });
}

const PREFIXES = ['/api/auth', '/api/tours', '/api/geocode'];

/** Gateway laid out like gateway/src/index.js: metrics, health, /metrics, geocode, proxies, 404. */
async function gateway() {
  const target = await listen((req, res) => {
    res.writeHead(req.url.startsWith('/missing') ? 404 : 200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  const metrics = createMetrics({ prefixes: PREFIXES });
  const app = express();
  app.use(metrics.httpMiddleware());
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', (_req, res) => res.json({ status: 'ready' }));
  metrics.registerMetricsRoute(app);
  app.get('/api/geocode', (_req, res) => res.json([]));
  for (const p of ['/api/auth', '/api/tours']) app.use(p, createProxyMiddleware({ target, changeOrigin: true }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  const url = await listen(app);
  const scrape = () => fetch(`${url}/metrics`).then((r) => r.text());
  return { url, scrape };
}

const count = (text, route, status, method = 'GET') => {
  const line = text
    .split('\n')
    .find(
      (l) =>
        l.startsWith('http_requests_total{') &&
        l.includes(`method="${method}"`) &&
        l.includes(`route="${route}"`) &&
        l.includes(`status="${status}"`),
    );
  return line ? Number(line.split(' ').pop()) : 0;
};

test('routeLabel(): mount prefix or unmatched, never a partial segment', () => {
  assert.equal(routeLabel('/api/tours', PREFIXES), '/api/tours');
  assert.equal(routeLabel('/api/tours/3f2a/places', PREFIXES), '/api/tours');
  assert.equal(routeLabel('/api/toursx', PREFIXES), 'unmatched');
  assert.equal(routeLabel('/api/geocode', PREFIXES), '/api/geocode');
  assert.equal(routeLabel('/', PREFIXES), 'unmatched');
});

test('proxied requests are labelled with the mount prefix, ids and query strings are dropped', async () => {
  const { url, scrape } = await gateway();
  await fetch(`${url}/api/tours/3f2a6c1e-0000-4000-8000-000000000001?q=hue&email=a%40b.c`);
  await fetch(`${url}/api/tours/missing`);
  await fetch(`${url}/api/auth/login`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  await fetch(`${url}/api/geocode?q=hue`);
  const text = await scrape();
  assert.equal(count(text, '/api/tours', 200), 1);
  assert.equal(count(text, '/api/tours', 404), 1);
  assert.equal(count(text, '/api/auth', 200, 'POST'), 1);
  assert.equal(count(text, '/api/geocode', 200), 1);
  assert.doesNotMatch(text, /3f2a6c1e|missing|email|q=hue|login/);
  assert.match(text, /http_request_duration_seconds_bucket\{[^}]*le="0\.05"[^}]*route="\/api\/tours"/);
  assert.match(text, /service="gateway"/);
  assert.match(text, /^process_cpu_user_seconds_total\{service="gateway"\} /m);
});

test('unknown paths are unmatched; probes and /metrics are not counted', async () => {
  const { url, scrape } = await gateway();
  await fetch(`${url}/api/nope/123`);
  await fetch(`${url}/api/metrics`);
  for (const p of ['/healthz', '/readyz', '/metrics']) await fetch(url + p);
  const text = await scrape();
  assert.equal(count(text, 'unmatched', 404), 2);
  assert.doesNotMatch(text, /route="\/(healthz|readyz|metrics)"/);
  const counted = text.split('\n').filter((l) => l.startsWith('http_requests_total{'));
  assert.equal(counted.length, 1, counted.join('\n'));
});
