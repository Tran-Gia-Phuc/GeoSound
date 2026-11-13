// Gateway request log tests (deployment plan task 0.9, #355): a new x-request-id per request,
// forwarded to the upstream service through http-proxy-middleware and echoed to the client.
// Fake upstream on 127.0.0.1, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createRequestLogger, levelFor } from '../src/request-log.js';

const servers = [];
after(() => servers.forEach((s) => (s.closeAllConnections(), s.close())));

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`));
  });
}

/** Gateway with the logger and one proxied mount, like gateway/src/index.js. */
async function gateway(upstreamStatus = 200) {
  const seen = [];
  const target = await listen((req, res) => {
    seen.push(req.headers['x-request-id']);
    res.writeHead(upstreamStatus, { 'content-type': 'application/json' });
    res.end('{}');
  });
  const lines = [];
  let n = 0;
  const app = express();
  app.use(createRequestLogger({ write: (l) => lines.push(JSON.parse(l)), newId: () => `id-${++n}` }));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/tours', createProxyMiddleware({ target, changeOrigin: true }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  const url = await listen(app);
  return { url, seen, lines };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test('creates a new id (ignores the client one), forwards it upstream and echoes it', async () => {
  const { url, seen, lines } = await gateway();
  const res = await fetch(`${url}/api/tours/abc?lang=vi`, { headers: { 'x-request-id': 'spoofed' } });
  await settle();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-request-id'), 'id-1');
  assert.deepEqual(seen, ['id-1']);
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.deepEqual(Object.keys(line), [
    'time', 'level', 'service', 'msg', 'reqId', 'method', 'path', 'status', 'durationMs',
  ]);
  assert.equal(line.service, 'gateway');
  assert.equal(line.reqId, 'id-1');
  assert.equal(line.path, '/api/tours/abc');
  assert.equal(line.status, 200);
  assert.equal(line.level, 'info');
});

test('upstream 5xx is logged as error; 404 as warn; successful probes are skipped', async () => {
  const { url, lines } = await gateway(502);
  await fetch(`${url}/api/tours`);
  await fetch(`${url}/nope`);
  await fetch(`${url}/healthz`);
  await settle();
  assert.deepEqual(lines.map((l) => [l.path, l.status, l.level]), [
    ['/api/tours', 502, 'error'],
    ['/nope', 404, 'warn'],
  ]);
  assert.deepEqual([levelFor(200), levelFor(429), levelFor(500)], ['info', 'warn', 'error']);
});
