// Tests for the structured request log (deployment plan task 0.9, #355). Local express app, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createRequestLogger,
  requestIdFrom,
  serviceName,
  resetServiceName,
  levelFor,
} from '../middleware/request-log.js';
import { errorHandler } from '../middleware/index.js';

const servers = [];
after(() => servers.forEach((s) => (s.closeAllConnections(), s.close())));

// shared/ has no express: a plain node:http server runs the middleware, then a tiny router.
const ROUTES = {
  '/healthz': [200, () => ({ status: 'ok' })],
  '/readyz': [503, () => ({ status: 'not_ready' })],
  '/ok': [200, (req) => ({ id: req.id })],
  '/missing': [404, () => ({ error: 'Not found' })],
  '/boom': [500, () => ({ error: 'db down' })],
};

/** Server with the logger and the routes above; log lines are collected. */
async function start({ service = 'tour' } = {}) {
  const lines = [];
  const log = createRequestLogger({ service, write: (l) => lines.push(JSON.parse(l)) });
  const srv = http.createServer((req, res) => {
    log(req, res, () => {
      const [status, body] = ROUTES[req.url.split('?')[0]];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body(req)));
    });
  });
  servers.push(srv);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, lines };
}

// The 'finish' listener runs right after the response is written; give it one tick.
const settle = () => new Promise((r) => setTimeout(r, 20));

test('one JSON line per request with every field; path has no query string', async () => {
  const { url, lines } = await start();
  const res = await fetch(`${url}/ok?token=secret&q=1`);
  await settle();
  assert.equal(res.status, 200);
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.deepEqual(Object.keys(line), [
    'time', 'level', 'service', 'msg', 'reqId', 'method', 'path', 'status', 'durationMs',
  ]);
  assert.match(line.time, /Z$/);
  assert.equal(line.level, 'info');
  assert.equal(line.service, 'tour');
  assert.equal(line.msg, 'request');
  assert.equal(line.method, 'GET');
  assert.equal(line.path, '/ok');
  assert.equal(line.status, 200);
  assert.equal(typeof line.durationMs, 'number');
  assert.ok(!JSON.stringify(line).includes('secret'));
});

test('reuses a safe incoming x-request-id, echoes it and sets req.id', async () => {
  const { url, lines } = await start();
  const res = await fetch(`${url}/ok`, { headers: { 'x-request-id': 'gw-123_abc.4' } });
  await settle();
  assert.equal(res.headers.get('x-request-id'), 'gw-123_abc.4');
  assert.equal((await res.json()).id, 'gw-123_abc.4');
  assert.equal(lines[0].reqId, 'gw-123_abc.4');
});

test('replaces an unsafe or missing x-request-id with a new UUID', async () => {
  const { url, lines } = await start();
  const res = await fetch(`${url}/ok`, { headers: { 'x-request-id': 'bad id"\\{}' } });
  await fetch(`${url}/ok`);
  await settle();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assert.match(res.headers.get('x-request-id'), uuid);
  assert.match(lines[0].reqId, uuid);
  assert.match(lines[1].reqId, uuid);
  assert.notEqual(lines[0].reqId, lines[1].reqId);
  assert.match(requestIdFrom('x'.repeat(129)), uuid);
  assert.equal(requestIdFrom(['a-1', 'b-2']), 'a-1');
});

test('levels: 4xx warn, 5xx error', async () => {
  const { url, lines } = await start();
  await fetch(`${url}/missing`);
  const res = await fetch(`${url}/boom`);
  await settle();
  assert.equal(res.status, 500);
  const missing = lines.find((l) => l.path === '/missing');
  assert.equal(missing.level, 'warn');
  assert.equal(missing.status, 404);
  const boom = lines.find((l) => l.path === '/boom');
  assert.equal(boom.level, 'error');
  assert.equal(boom.status, 500);
  assert.deepEqual([levelFor(200), levelFor(301), levelFor(400), levelFor(503)], ['info', 'info', 'warn', 'error']);
});

test('errorHandler logs JSON with reqId; stack only for 5xx', async (t) => {
  const out = [];
  t.mock.method(console, 'error', (l) => out.push(JSON.parse(l)));
  t.mock.method(console, 'log', (l) => out.push(JSON.parse(l)));
  const res = { status() { return this; }, json() { return this; } };
  const err500 = new Error('db down');
  errorHandler(err500, { id: 'r1', method: 'POST', originalUrl: '/tours?x=1' }, res, () => {});
  const err400 = Object.assign(new Error('Bad input'), { status: 400, code: 'invalid' });
  errorHandler(err400, { id: 'r2', method: 'GET', originalUrl: '/tours' }, res, () => {});
  assert.equal(out[0].level, 'error');
  assert.equal(out[0].msg, 'db down');
  assert.equal(out[0].reqId, 'r1');
  assert.equal(out[0].path, '/tours');
  assert.match(out[0].err.stack, /db down/);
  assert.equal(out[1].level, 'warn');
  assert.equal(out[1].code, 'invalid');
  assert.equal(out[1].err, undefined);
});

test('successful health probes are not logged; a failing probe is', async () => {
  const { url, lines } = await start();
  await fetch(`${url}/healthz`);
  await fetch(`${url}/readyz`);
  await settle();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].path, '/readyz');
  assert.equal(lines[0].status, 503);
});

test('service name: SERVICE_NAME, else package.json name of the working dir without scope', (t) => {
  const cwd = process.cwd();
  const dir = mkdtempSync(path.join(tmpdir(), 'svc-'));
  t.after(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    delete process.env.SERVICE_NAME;
    resetServiceName();
  });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@geosound/tour' }));
  process.chdir(dir);

  resetServiceName();
  process.env.SERVICE_NAME = 'moderation';
  assert.equal(serviceName(), 'moderation');

  delete process.env.SERVICE_NAME;
  resetServiceName();
  assert.equal(serviceName(), 'tour');

  rmSync(path.join(dir, 'package.json'));
  resetServiceName();
  assert.equal(serviceName(), 'unknown');
});
