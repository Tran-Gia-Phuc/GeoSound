// Chat route tests (#188): fake AI upstream on 127.0.0.1, in-memory limiter store.
// No network, no Redis, no real AI.
//   node --test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { mountChat } from '../src/chat.js';
import { createChatRateLimit, createMemoryStore } from '../src/chat-rate-limit.js';

const servers = [];
after(() => servers.forEach((s) => (s.closeAllConnections(), s.close())));

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`));
  });
}

async function gateway(opts) {
  const app = express();
  mountChat(app, { log: () => {}, ...opts });
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return listen(app);
}

/** Upstream that records requests and answers JSON. */
async function echoUpstream(status = 200) {
  const seen = [];
  const url = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { ok: true } : { error: 'All providers failed' }));
    });
  });
  return { url, seen };
}

const postChat = (base, headers = {}) =>
  fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ message: 'Xin chào', session_id: 's1' }),
  });

test('flag off: /api/chat and /api/chat/history are 404, upstream not called', async () => {
  const up = await echoUpstream();
  const base = await gateway({ enabled: false, target: up.url, token: 'secret' });
  assert.equal((await postChat(base)).status, 404);
  assert.equal((await fetch(`${base}/api/chat/history?session_id=s1`)).status, 404);
  assert.equal(up.seen.length, 0);
});

test('token added by the gateway, client token stripped, body and query forwarded', async () => {
  const up = await echoUpstream();
  const base = await gateway({ enabled: true, target: up.url, token: 'secret' });

  const r = await postChat(base, { 'x-internal-token': 'forged' });
  assert.equal(r.status, 200);
  assert.equal(up.seen[0].method, 'POST');
  assert.equal(up.seen[0].url, '/chat');
  assert.equal(up.seen[0].headers['x-internal-token'], 'secret');
  assert.deepEqual(JSON.parse(up.seen[0].body), { message: 'Xin chào', session_id: 's1' });

  const h = await fetch(`${base}/api/chat/history?session_id=s1`, { headers: { 'x-internal-token': 'forged' } });
  assert.equal(h.status, 200);
  assert.equal(up.seen[1].url, '/chat/history?session_id=s1');
  assert.equal(up.seen[1].headers['x-internal-token'], 'secret');
});

test('no token configured: client token is still not forwarded', async () => {
  const up = await echoUpstream();
  const base = await gateway({ enabled: true, target: up.url, token: '' });
  await postChat(base, { 'x-internal-token': 'forged' });
  assert.equal(up.seen[0].headers['x-internal-token'], undefined);
});

test('SSE: events arrive incrementally, not buffered', async () => {
  let release; // upstream waits for this before writing the last event
  const gate = new Promise((r) => (release = r));
  let lastWritten = false;
  const upUrl = await listen(async (req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: meta\ndata: {"session_id":"s1","lang":"vi"}\n\n');
    await new Promise((r) => setTimeout(r, 30));
    res.write('event: token\ndata: {"text":"Xin"}\n\n');
    await gate;
    lastWritten = true;
    res.end('event: done\ndata: {"finish_reason":"stop","llm_calls":1}\n\n');
  });
  const base = await gateway({ enabled: true, target: upUrl, token: 'secret' });

  const r = await postChat(base);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.equal(r.headers.get('x-accel-buffering'), 'no');

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  while (!text.includes('event: meta')) text += dec.decode((await reader.read()).value, { stream: true });
  assert.equal(lastWritten, false, 'first event must arrive before the last one is written');

  release();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
  }
  assert.ok(lastWritten);
  assert.match(text, /event: token/);
  assert.match(text, /event: done/);
});

test('client abort closes the upstream stream', async () => {
  let upstreamClosed;
  const closed = new Promise((r) => (upstreamClosed = r));
  const upUrl = await listen((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: meta\ndata: {}\n\n');
    res.on('close', () => upstreamClosed(true)); // never ends by itself
  });
  const base = await gateway({ enabled: true, target: upUrl, token: 'secret' });
  const ctl = new AbortController();
  const r = await fetch(`${base}/api/chat`, { method: 'POST', body: '{}', signal: ctl.signal });
  await r.body.getReader().read();
  ctl.abort();
  const timeout = new Promise((r) => setTimeout(() => r(false), 2000));
  assert.equal(await Promise.race([closed, timeout]), true);
});

test('429 with Retry-After after the per-minute limit (in-memory store)', async () => {
  const up = await echoUpstream();
  const limiter = createChatRateLimit({ store: createMemoryStore(), perMin: 2, perDay: 100 });
  const base = await gateway({ enabled: true, target: up.url, token: 'secret', limiter });

  assert.equal((await postChat(base)).status, 200);
  assert.equal((await postChat(base)).status, 200);
  const r = await postChat(base);
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.deepEqual(await r.json(), { error: 'Too many chat requests' });
  assert.equal(up.seen.length, 2);
});

test('limiter: per-day limit and fail-open when the store fails', async () => {
  let nexts = 0;
  const next = () => { nexts += 1; };
  const res = () => {
    const r = { code: 200, headers: {}, body: null };
    r.set = (k, v) => ((r.headers[k] = v), r);
    r.status = (c) => ((r.code = c), r);
    r.json = (b) => ((r.body = b), r);
    return r;
  };
  const day = createChatRateLimit({ store: createMemoryStore(), perMin: 100, perDay: 1 });
  await day({ ip: '1.2.3.4' }, res(), next);
  assert.equal(nexts, 1);
  const blocked = res();
  await day({ ip: '1.2.3.4' }, blocked, next);
  assert.equal(blocked.code, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 60);

  const logs = [];
  const broken = createChatRateLimit({
    store: { hit: async () => { throw new Error('redis unavailable'); } },
    log: (m) => logs.push(m),
  });
  await broken({ ip: '1.2.3.4' }, res(), next);
  assert.equal(nexts, 2);
  assert.equal(logs.length, 1);
});

test('upstream 503 JSON passes through unchanged', async () => {
  const up = await echoUpstream(503);
  const base = await gateway({ enabled: true, target: up.url, token: 'secret' });
  const r = await postChat(base);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'All providers failed' });
});

test('upstream down: 503 JSON from the gateway', async () => {
  const base = await gateway({ enabled: true, target: 'http://127.0.0.1:1', token: 'secret' });
  const r = await postChat(base);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'Chat service unavailable' });
});
