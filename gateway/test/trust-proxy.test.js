// TRUST_PROXY parsing and its effect on req.ip (deployment plan task 0.10, #361). Local server only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { parseTrustProxy } from '../src/trust-proxy.js';

const servers = [];
after(() => servers.forEach((s) => (s.closeAllConnections(), s.close())));

test('parseTrustProxy: unset keeps the express default; numbers, booleans and strings', () => {
  assert.equal(parseTrustProxy(undefined), undefined);
  assert.equal(parseTrustProxy(''), undefined);
  assert.equal(parseTrustProxy('  '), undefined);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy(' 2 '), 2);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
});

async function ipOf(trust, headers) {
  const app = express();
  const value = parseTrustProxy(trust);
  if (value !== undefined) app.set('trust proxy', value);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const srv = http.createServer(app);
  servers.push(srv);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/ip`, { headers });
  return (await res.json()).ip;
}

test('with TRUST_PROXY=1 req.ip is the client IP set by the proxy; unset it is the socket', async () => {
  const headers = { 'x-forwarded-for': '203.0.113.7' };
  assert.equal(await ipOf('1', headers), '203.0.113.7');
  assert.match(await ipOf(undefined, headers), /127\.0\.0\.1$/);
  // One trusted hop: a client-sent value before the proxy's entry is ignored.
  assert.equal(await ipOf('1', { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }), '203.0.113.7');
});
