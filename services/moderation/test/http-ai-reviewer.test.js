// HTTP AI reviewer (task #AI-34) against a real local server on 127.0.0.1 (no external network).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpAiReviewer } from '../src/infrastructure/ai/http-ai-reviewer.js';
import { AiTemporaryError, AiPermanentError } from '../src/domain/errors/index.js';

const TOKEN = 'test-token';
let server;
let baseUrl;
let hits;
let script; // array of (req, res, body) handlers; the last one repeats

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      hits.push({ method: req.method, path: req.url, token: req.headers['x-internal-token'], type: req.headers['content-type'], body });
      const handler = script[Math.min(hits.length - 1, script.length - 1)];
      handler(req, res, body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

beforeEach(() => { hits = []; script = []; });

const reply = (status, json) => (req, res) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json === undefined ? '' : JSON.stringify(json));
};

const reviewer = (extra = {}) => {
  const delays = [];
  const r = new HttpAiReviewer({
    baseUrl: `${baseUrl}/`, token: TOKEN, timeoutMs: 2000, sleep: async (ms) => { delays.push(ms); }, ...extra,
  });
  return { r, delays };
};

const placeEvent = {
  placeId: 'p1', tourId: 't1', contributorId: 'u1', revision: '2026-01-01T00:00:00.000Z',
  name: 'Ben Thanh', description: 'x'.repeat(2500), language: 'en', lat: 10.77, lng: 106.69, city: 'HCM',
};
const tourEvent = {
  tourId: 't1', contributorId: 'u1', title: 'Food walk', description: 'Street food', language: 'vi',
  type: 'walking', durationMinutes: 120,
  places: [{ placeId: 'p1', name: 'Ben Thanh', description: 'Market', lat: 10.77, lng: 106.69, sequence: 0 }],
};
const okPlace = {
  place_id: 'p1', verdict: 'Warning', severity: 0.55,
  reasons: [{ field: 'description', category: 'misleading', message: 'Hours look wrong.' }],
  images_checked: 0, model: 'gemini-2.5-flash',
};

test('200 place: path, token header, snake_case truncated body, mapped result', async () => {
  script = [reply(200, okPlace)];
  const { r, delays } = reviewer();
  const out = await r.reviewPlace(placeEvent);
  assert.deepEqual(out, {
    verdict: 'Warning', severity: 0.55,
    reasons: [{ field: 'description', category: 'misleading', message: 'Hours look wrong.', source: 'ai' }],
    imagesChecked: 0, model: 'gemini-2.5-flash',
  });
  assert.equal(hits.length, 1);
  const [h] = hits;
  assert.equal(h.method, 'POST');
  assert.equal(h.path, '/moderate/place');
  assert.equal(h.token, TOKEN);
  assert.match(h.type, /application\/json/);
  assert.deepEqual(Object.keys(h.body).sort(), ['city', 'description', 'language', 'name', 'place_id', 'tour_id']);
  assert.equal(h.body.place_id, 'p1');
  assert.equal(h.body.description.length, 2000);
  assert.deepEqual(delays, []);
});

test('200 tour: path and snake_case body; result has no imagesChecked', async () => {
  script = [reply(200, { tour_id: 't1', verdict: 'Pass', severity: 0.1, reasons: [], model: 'llama-3.3' })];
  const { r } = reviewer();
  const out = await r.reviewTour(tourEvent);
  assert.deepEqual(out, { verdict: 'Pass', severity: 0.1, reasons: [], model: 'llama-3.3' });
  assert.equal(hits[0].path, '/moderate/tour');
  assert.equal(hits[0].token, TOKEN);
  assert.deepEqual(hits[0].body, {
    tour_id: 't1', title: 'Food walk', description: 'Street food', language: 'vi', type: 'walking',
    duration_minutes: 120, places: [{ place_id: 'p1', name: 'Ben Thanh', description: 'Market' }],
  });
});

test('422 is permanent and not retried', async () => {
  script = [reply(422, { detail: 'bad' })];
  const { r, delays } = reviewer();
  await assert.rejects(r.reviewPlace(placeEvent),
    (e) => e instanceof AiPermanentError && e.status === 422 && e.kind === 'invalid_input');
  assert.equal(hits.length, 1);
  assert.deepEqual(delays, []);
});

test('other 4xx (400) is permanent and not retried', async () => {
  script = [reply(400, { detail: 'bad' })];
  const { r } = reviewer();
  await assert.rejects(r.reviewTour(tourEvent), (e) => e instanceof AiPermanentError && e.status === 400);
  assert.equal(hits.length, 1);
});

test('503 is retried 3 times (2 s, 4 s) then fails as temporary', async () => {
  script = [reply(503, { detail: 'down' })];
  const { r, delays } = reviewer();
  await assert.rejects(r.reviewPlace(placeEvent),
    (e) => e instanceof AiTemporaryError && e.status === 503 && e.kind === 'server');
  assert.equal(hits.length, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test('429 is retried and then succeeds', async () => {
  script = [reply(429, { detail: 'slow down' }), reply(200, okPlace)];
  const { r, delays } = reviewer();
  const out = await r.reviewPlace(placeEvent);
  assert.equal(out.verdict, 'Warning');
  assert.equal(hits.length, 2);
  assert.deepEqual(delays, [2000]);
});

test('timeout is a temporary error and is retried', async () => {
  script = [(req, res) => { setTimeout(() => reply(200, okPlace)(req, res), 300); }];
  const { r, delays } = reviewer({ timeoutMs: 50 });
  await assert.rejects(r.reviewPlace(placeEvent), (e) => e instanceof AiTemporaryError && e.kind === 'timeout');
  assert.equal(hits.length, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test('401 is a temporary configuration error, called once', async () => {
  script = [reply(401, { detail: 'bad token' })];
  const { r, delays } = reviewer();
  await assert.rejects(r.reviewPlace(placeEvent),
    (e) => e instanceof AiTemporaryError && e.status === 401 && e.kind === 'config');
  assert.equal(hits.length, 1);
  assert.deepEqual(delays, []);
});

test('malformed 200 body is temporary and retried', async () => {
  script = [reply(200, { verdict: 'Maybe' }), reply(200, okPlace)];
  const { r } = reviewer();
  assert.equal((await r.reviewPlace(placeEvent)).verdict, 'Warning');
  assert.equal(hits.length, 2);
});

test('network error (closed port) is temporary and retried', async () => {
  const tmp = http.createServer();
  await new Promise((res) => tmp.listen(0, '127.0.0.1', res));
  const { port } = tmp.address();
  await new Promise((res) => tmp.close(res));
  const { r, delays } = reviewer({ baseUrl: `http://127.0.0.1:${port}` });
  await assert.rejects(r.reviewPlace(placeEvent), (e) => e instanceof AiTemporaryError && e.kind === 'network');
  assert.deepEqual(delays, [2000, 4000]);
});

test('the token is not exposed when the reviewer is inspected or serialized', () => {
  const { r } = reviewer();
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  assert.ok(!Object.keys(r).includes('token'));
});
