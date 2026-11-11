// Tests for shared/shutdown: ordered steps, time limits, signals and closeServer (issue #348).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createShutdown, closeServer } from '../shutdown/index.js';

const silentLog = () => {
  const lines = [];
  const add = (level) => (m) => lines.push([level, m]);
  return { lines, log: add('log'), warn: add('warn'), error: add('error') };
};

// A fake process (signals) and a recorded exit code.
function harness(options = {}) {
  const proc = new EventEmitter();
  const exits = [];
  const log = silentLog();
  const sd = createShutdown({ service: 'svc', proc, log, exit: (code) => exits.push(code), ...options });
  return { sd, proc, exits, log };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('createShutdown: service is required', () => {
  assert.throws(() => createShutdown({ proc: new EventEmitter() }), /service is required/);
});

test('run(): steps run once, in order, then exit 0', async () => {
  const { sd, exits } = harness();
  const order = [];
  sd.add('a', async () => { await sleep(10); order.push('a'); })
    .add('b', () => order.push('b'));
  assert.equal(sd.isShuttingDown(), false);
  const p = sd.run('test');
  assert.equal(sd.isShuttingDown(), true);
  assert.equal(sd.run('again'), p, 'a second run() returns the same promise');
  assert.equal(await p, 0);
  assert.deepEqual(order, ['a', 'b']);
  assert.deepEqual(exits, [0]);
});

test('run(): a failing step is logged and the next one still runs', async () => {
  const { sd, exits, log } = harness();
  const order = [];
  sd.add('bad', () => { throw new Error('boom'); }).add('good', () => order.push('good'));
  await sd.run();
  assert.deepEqual(order, ['good']);
  assert.deepEqual(exits, [0]);
  assert.ok(log.lines.some(([lvl, m]) => lvl === 'warn' && m.includes('bad failed: boom')));
});

test('run(): a step over its own timeout is left behind, the next one runs', async () => {
  const { sd, exits, log } = harness();
  const order = [];
  sd.add('slow', () => new Promise(() => {}), { timeoutMs: 20 }).add('next', () => order.push('next'));
  await sd.run();
  assert.deepEqual(order, ['next']);
  assert.deepEqual(exits, [0]);
  assert.ok(log.lines.some(([lvl, m]) => lvl === 'warn' && m.includes('slow did not finish in 20 ms')));
});

test('run(): over the overall timeout exits 1', async () => {
  const { sd, exits } = harness({ timeoutMs: 30 });
  sd.add('stuck', () => new Promise(() => {}));
  assert.equal(await sd.run(), 1);
  assert.deepEqual(exits, [1]);
});

test('SIGTERM starts the shutdown; a second signal exits at once', async () => {
  const { sd, proc, exits, log } = harness();
  let release;
  sd.add('wait', () => new Promise((r) => { release = r; }));
  proc.emit('SIGTERM');
  assert.equal(sd.isShuttingDown(), true);
  proc.emit('SIGINT');
  assert.deepEqual(exits, [1]);
  assert.ok(log.lines.some(([lvl, m]) => lvl === 'warn' && m.includes('SIGINT again')));
  await sleep(5); // steps start on the next tick
  release();
  await sd.run();
  assert.deepEqual(exits, [1, 0]);
});

test('closeServer(): stops accepting, lets the request in flight finish', async () => {
  let finish;
  const server = http.createServer((_req, res) => {
    finish = () => res.end('done');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const body = new Promise((resolve, reject) => {
    http.get({ port, host: '127.0.0.1', agent: false }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
  await sleep(30); // the request is in flight
  let closed = false;
  const closing = closeServer(server, { timeoutMs: 2000 }).then(() => { closed = true; });
  await sleep(20);
  assert.equal(closed, false);
  assert.equal(server.listening, false, 'no new connections');
  finish();
  assert.equal(await body, 'done');
  await closing;
});

test('closeServer(): closes a hanging connection after timeoutMs', async () => {
  const server = http.createServer(() => {}); // never answers (like an SSE stream)
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const req = http.get({ port, host: '127.0.0.1', agent: false });
  const ended = new Promise((resolve) => req.on('error', resolve));
  await sleep(30);
  const t0 = Date.now();
  await closeServer(server, { timeoutMs: 50 });
  assert.ok(Date.now() - t0 < 1000);
  await ended; // the client sees the socket closed
});

test('closeServer(): no server is a no-op', async () => {
  await closeServer(undefined);
});
