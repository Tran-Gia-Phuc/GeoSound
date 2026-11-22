// UC15 moderation scenarios: the pipeline wired like container.js, end to end inside Moderation.
// Real consumers -> use-cases (review-case-flow, sweeper) -> real HttpAiReviewer + with-retry -> a local fake
// AI HTTP server on 127.0.0.1 (scripted answers, no external network) -> real EventPublisher validating every
// event with the shared zod contract -> capturing raw publish. Only the repository is in memory.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpAiReviewer } from '../src/infrastructure/ai/http-ai-reviewer.js';
import { EventPublisher } from '../src/infrastructure/messaging/event-publisher.js';
import { RunPlaceReview, PERMANENT_ERROR_REASON } from '../src/application/use-cases/run-place-review.js';
import { RunTourReview, TOUR_INCOMPLETE_REASON } from '../src/application/use-cases/run-tour-review.js';
import { RetryFailedCases } from '../src/application/use-cases/retry-failed-cases.js';
import { createPlaceSubmittedHandler } from '../src/interfaces/events/place-submitted-consumer.js';
import { createTourSubmittedHandler } from '../src/interfaces/events/tour-submitted-consumer.js';
import { startRetrySweeper } from '../src/interfaces/jobs/retry-sweeper.js';
import { InMemoryModerationRepository } from './helpers/in-memory-moderation-repository.js';
import { FakeClock, FakeLogger, validateEvent } from './helpers/fakes.js';

const TOKEN = 'uc15-test-token';
const REV = '2026-03-01T08:00:00.000Z';
const FAILED_AFTER_MS = 60_000;

let server;
let baseUrl;
let hits; // every request the fake AI received
let script; // (req, res, body) handlers in order; the last one repeats

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      hits.push({ path: req.url, token: req.headers['x-internal-token'], body: raw ? JSON.parse(raw) : null });
      script[Math.min(hits.length - 1, script.length - 1)](req, res);
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
const hang = () => () => {}; // never answers: the reviewer times out

// Wiring as in src/container.js, with the in-memory repository and a capturing raw publish.
function wire({ timeoutMs = 2000 } = {}) {
  const clock = new FakeClock(new Date('2026-03-01T09:00:00.000Z'));
  const repo = new InMemoryModerationRepository({ clock });
  const logger = new FakeLogger();
  const published = [];
  const publisher = new EventPublisher({
    publish: async (eventName, payload) => { published.push({ eventName, payload }); },
    validate: validateEvent,
  });
  const aiReviewer = new HttpAiReviewer({ baseUrl, token: TOKEN, timeoutMs, maxAttempts: 3, retryDelayMs: 1 });
  const runPlaceReview = new RunPlaceReview({ repo, aiReviewer, publisher, clock, logger });
  const runTourReview = new RunTourReview({ repo, aiReviewer, publisher, clock, logger });
  const retryFailedCases = new RetryFailedCases({
    repo, runPlaceReview, runTourReview, clock, logger,
    config: { failedAfterMs: FAILED_AFTER_MS, staleAfterMs: FAILED_AFTER_MS, batchSize: 10 },
  });
  const onPlace = createPlaceSubmittedHandler({ runPlaceReview, validate: validateEvent, logger });
  const onTour = createTourSubmittedHandler({ runTourReview, validate: validateEvent, logger });
  const caseOf = (subjectType, subjectId, revision = REV) => repo.find({ subjectType, subjectId, revision });
  return { clock, repo, logger, published, retryFailedCases, onPlace, onTour, caseOf };
}

// Every captured event must satisfy the shared contract again and carry an `at` ending with Z.
function contractChecked(published) {
  for (const { eventName, payload } of published) {
    assert.deepEqual(validateEvent(eventName, payload), payload);
    assert.match(payload.at, /Z$/);
  }
  return published;
}

const placeEvent = (over = {}) => ({
  placeId: 'p1', tourId: 't1', contributorId: 'u1', revision: REV,
  name: 'Ben Thanh Market', type: 'market', description: 'Central market of District 1.',
  language: 'vi', lat: 10.772, lng: 106.698, city: 'HCM', at: '2026-03-01T08:00:01.000Z', ...over,
});
const placeAi = (over = {}) => ({
  place_id: 'p1', verdict: 'Pass', severity: 0.1, reasons: [], images_checked: 0, model: 'gemini-2.5-flash', ...over,
});

// near -> far is about 3.3 km (G3 long leg for walking); near -> close is about 1.1 km (no geo finding).
const near = { placeId: 'pA', name: 'Ben Thanh Market', description: 'Market.', lat: 10.77, lng: 106.69, sequence: 0 };
const far = { placeId: 'pB', name: 'Tan Dinh Church', description: 'Pink church.', lat: 10.80, lng: 106.69, sequence: 1 };
const close = { placeId: 'pB', name: 'Opera House', description: 'Theatre.', lat: 10.78, lng: 106.69, sequence: 1 };
const tourEvent = (over = {}) => ({
  tourId: 't1', contributorId: 'u1', revision: REV, title: 'Saigon walk', description: 'A walk through District 1.',
  language: 'vi', city: 'HCM', type: 'walking', durationMinutes: 120, places: [near, close], ...over,
});
const tourAi = (over = {}) => ({ tour_id: 't1', verdict: 'Pass', severity: 0.1, reasons: [], model: 'gemini-2.5-flash', ...over });

test('1. place Pass: snake_case AI body with the place fields, place.ai_passed without warning', async () => {
  script = [reply(200, placeAi())];
  const w = wire();
  await w.onPlace('place.submitted', placeEvent());

  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, '/moderate/place');
  assert.equal(hits[0].token, TOKEN);
  assert.deepEqual(hits[0].body, {
    place_id: 'p1', tour_id: 't1', name: 'Ben Thanh Market', type: 'market',
    description: 'Central market of District 1.', language: 'vi', city: 'HCM',
  });
  const [ev] = contractChecked(w.published);
  assert.equal(w.published.length, 1);
  assert.equal(ev.eventName, 'place.ai_passed');
  assert.deepEqual(ev.payload, {
    placeId: 'p1', tourId: 't1', revision: REV, warning: false, severity: 0.1, reasons: [], at: ev.payload.at,
  });
  const c = await w.caseOf('place', 'p1');
  assert.equal(c.status, 'done');
  assert.equal(c.model, 'gemini-2.5-flash');
  assert.ok(c.publishedAt instanceof Date);
});

test('2a. place Warning: place.ai_passed warning true with camelCase reasons (source ai)', async () => {
  script = [reply(200, placeAi({
    verdict: 'Warning', severity: 0.55,
    reasons: [{ field: 'description', category: 'misleading', message: 'Gio mo cua co ve sai.' }],
  }))];
  const w = wire();
  await w.onPlace('place.submitted', placeEvent());

  const [ev] = contractChecked(w.published);
  assert.equal(w.published.length, 1);
  assert.equal(ev.eventName, 'place.ai_passed');
  assert.equal(ev.payload.warning, true);
  assert.equal(ev.payload.severity, 0.55);
  assert.deepEqual(ev.payload.reasons, [
    { field: 'description', category: 'misleading', message: 'Gio mo cua co ve sai.', source: 'ai' },
  ]);
});

test('2b. place Reject: place.ai_rejected with a joined reason string and reasons[]', async () => {
  script = [reply(200, placeAi({
    verdict: 'Reject', severity: 0.9,
    reasons: [
      { field: 'description', category: 'scam', message: 'Asks for a deposit.' },
      { field: 'name', category: 'hate', message: 'Offensive name.' },
    ],
  }))];
  const w = wire();
  await w.onPlace('place.submitted', placeEvent());

  const [ev] = contractChecked(w.published);
  assert.equal(w.published.length, 1);
  assert.equal(ev.eventName, 'place.ai_rejected');
  assert.equal(ev.payload.reason, 'Asks for a deposit.; Offensive name.');
  assert.deepEqual(ev.payload.reasons.map((r) => [r.category, r.source]), [['scam', 'ai'], ['hate', 'ai']]);
  assert.equal('warning' in ev.payload, false);
  assert.equal((await w.caseOf('place', 'p1')).verdict, 'Reject');
});

test('3a. place 422: no retry, published as a Warning for human review, case failed_permanent', async () => {
  script = [reply(422, { detail: 'invalid input' })];
  const w = wire();
  await w.onPlace('place.submitted', placeEvent());

  assert.equal(hits.length, 1);
  const [ev] = contractChecked(w.published);
  assert.equal(w.published.length, 1);
  assert.equal(ev.eventName, 'place.ai_passed');
  assert.equal(ev.payload.warning, true);
  assert.deepEqual(ev.payload.reasons, [{ ...PERMANENT_ERROR_REASON }]);
  assert.equal((await w.caseOf('place', 'p1')).status, 'failed_permanent');
});

test('3b. place 503 twice then 200: three AI calls, one publish', async () => {
  script = [reply(503, { detail: 'down' }), reply(503, { detail: 'down' }), reply(200, placeAi())];
  const w = wire();
  await w.onPlace('place.submitted', placeEvent());

  assert.equal(hits.length, 3);
  assert.ok(hits.every((h) => h.path === '/moderate/place' && h.body.place_id === 'p1'));
  contractChecked(w.published);
  assert.deepEqual(w.published.map((e) => e.eventName), ['place.ai_passed']);
  const c = await w.caseOf('place', 'p1');
  assert.equal(c.status, 'done');
  assert.equal(c.lastError, null);
});

test('3c. place 503 always: nothing published, ai_failed; sweeper with AI healthy publishes once', async () => {
  script = [reply(503, { detail: 'down' })];
  const w = wire();
  await w.onPlace('place.submitted', placeEvent());

  assert.equal(hits.length, 3);
  assert.equal(w.published.length, 0);
  const failed = await w.caseOf('place', 'p1');
  assert.equal(failed.status, 'ai_failed');
  assert.match(failed.lastError, /503/);

  // AI is healthy again; the sweeper only picks the case once it is older than failedAfterMs.
  hits = [];
  script = [reply(200, placeAi({ verdict: 'Warning', severity: 0.45, reasons: [{ field: 'name', category: 'irrelevant', message: 'Vague name.' }] }))];
  const sweeper = startRetrySweeper({ retryFailedCases: w.retryFailedCases, intervalMs: 3_600_000, logger: w.logger });
  try {
    await sweeper.tick();
    assert.equal(hits.length, 0, 'too early for the sweeper');
    w.clock.advance(FAILED_AFTER_MS + 1);
    await sweeper.tick();
    await sweeper.tick(); // a second sweep finds nothing left to do
  } finally {
    await sweeper.stop();
  }
  assert.equal(hits.length, 1);
  // Retried from the stored payload: same snake_case body as the first call.
  assert.deepEqual(hits[0].body, {
    place_id: 'p1', tour_id: 't1', name: 'Ben Thanh Market', type: 'market',
    description: 'Central market of District 1.', language: 'vi', city: 'HCM',
  });
  const [ev] = contractChecked(w.published);
  assert.equal(w.published.length, 1);
  assert.equal(ev.eventName, 'place.ai_passed');
  assert.equal(ev.payload.warning, true);
  assert.equal(ev.payload.revision, REV);
  assert.equal((await w.caseOf('place', 'p1')).status, 'done');
});

test('4. place 401: one call (no retry), nothing published, case ai_failed with a config error', async () => {
  script = [reply(401, { detail: 'bad token' })];
  const w = wire();
  await w.onPlace('place.submitted', placeEvent());

  assert.equal(hits.length, 1);
  assert.equal(w.published.length, 0);
  const c = await w.caseOf('place', 'p1');
  assert.equal(c.status, 'ai_failed');
  assert.match(c.lastError, /config/);
});

test('5. duplicate place.submitted: one AI call, the stored result is re-published', async () => {
  script = [reply(200, placeAi({ verdict: 'Warning', severity: 0.5, reasons: [{ field: 'description', category: 'other', message: 'Check it.' }] }))];
  const w = wire();
  await w.onPlace('place.submitted', placeEvent());
  w.clock.advance(5_000);
  await w.onPlace('place.submitted', placeEvent());

  assert.equal(hits.length, 1);
  contractChecked(w.published);
  assert.equal(w.published.length, 2);
  const strip = ({ at, ...rest }) => rest;
  assert.deepEqual(strip(w.published[1].payload), strip(w.published[0].payload));
  assert.equal(w.published[1].eventName, 'place.ai_passed');
});

test('6a. tour AI Pass + geo long leg: snake_case tour body, tour.ai_passed warning with ai and geo reasons', async () => {
  script = [reply(200, tourAi({ severity: 0.2, reasons: [{ field: 'title', category: 'irrelevant', message: 'Minor note.' }] }))];
  const w = wire();
  await w.onTour('tour.submitted', tourEvent({ places: [near, far] }));

  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, '/moderate/tour');
  assert.deepEqual(hits[0].body, {
    tour_id: 't1', title: 'Saigon walk', description: 'A walk through District 1.', language: 'vi', city: 'HCM',
    type: 'walking', duration_minutes: 120,
    places: [
      { place_id: 'pA', name: 'Ben Thanh Market', description: 'Market.' },
      { place_id: 'pB', name: 'Tan Dinh Church', description: 'Pink church.' },
    ],
  });
  const [ev] = contractChecked(w.published);
  assert.equal(w.published.length, 1);
  assert.equal(ev.eventName, 'tour.ai_passed');
  assert.equal(ev.payload.warning, true);
  assert.equal(ev.payload.severity, 0.5);
  assert.deepEqual(ev.payload.reasons.map((r) => r.source), ['ai', 'geo']);
  assert.equal(ev.payload.reasons[1].category, 'route');
  assert.equal(ev.payload.contributorId, 'u1');
  assert.equal(ev.payload.tourTitle, 'Saigon walk');
});

test('6b. tour with an invalid coordinate (0,0) + AI Pass: tour.ai_rejected by geo G1', async () => {
  script = [reply(200, tourAi())];
  const w = wire();
  await w.onTour('tour.submitted', tourEvent({ places: [near, { ...close, lat: 0, lng: 0 }] }));

  assert.equal(hits.length, 1);
  const [ev] = contractChecked(w.published);
  assert.equal(w.published.length, 1);
  assert.equal(ev.eventName, 'tour.ai_rejected');
  const geo = ev.payload.reasons.filter((r) => r.source === 'geo');
  assert.equal(geo.length, 1);
  assert.equal(geo[0].field, 'places[1]');
  assert.equal(geo[0].category, 'route');
  assert.match(geo[0].message, /\(placeId pB\)$/);
  assert.ok(ev.payload.reason.includes(geo[0].message));
  const c = await w.caseOf('tour', 't1');
  assert.equal(c.verdict, 'Reject');
  assert.equal(c.severity, 1);
});

test('6c. tour AI Reject + geo warning: rejected, max severity, reasons from both sources', async () => {
  script = [reply(200, tourAi({ verdict: 'Reject', severity: 0.9, reasons: [{ field: 'description', category: 'scam', message: 'Sells fake tickets.' }] }))];
  const w = wire();
  await w.onTour('tour.submitted', tourEvent({ places: [near, far] }));

  const [ev] = contractChecked(w.published);
  assert.equal(w.published.length, 1);
  assert.equal(ev.eventName, 'tour.ai_rejected');
  assert.deepEqual(ev.payload.reasons.map((r) => r.source), ['ai', 'geo']);
  assert.ok(ev.payload.reason.startsWith('Sells fake tickets.; '));
  const c = await w.caseOf('tour', 't1');
  assert.equal(c.verdict, 'Reject');
  assert.equal(c.severity, 0.9); // max(AI 0.9, geo long leg 0.5)
});

test('7a. tour without revision: skipped, no AI call, no case, nothing published', async () => {
  script = [reply(200, tourAi())];
  const w = wire();
  const { revision, ...old } = tourEvent();
  await w.onTour('tour.submitted', old);

  assert.equal(hits.length, 0);
  assert.equal(w.published.length, 0);
  assert.equal(w.repo.rows.size, 0);
});

test('7b. tour without places: human-review Warning without an AI call', async () => {
  script = [reply(200, tourAi())];
  const w = wire();
  const { places, ...incomplete } = tourEvent();
  await w.onTour('tour.submitted', incomplete);

  assert.equal(hits.length, 0);
  const [ev] = contractChecked(w.published);
  assert.equal(w.published.length, 1);
  assert.equal(ev.eventName, 'tour.ai_passed');
  assert.equal(ev.payload.warning, true);
  assert.deepEqual(ev.payload.reasons, [{ ...TOUR_INCOMPLETE_REASON }]);
});

test('8. handlers never throw: AI timing out and invalid payloads resolve, retryable work is ai_failed', async () => {
  script = [hang()];
  const w = wire({ timeoutMs: 100 });

  await assert.doesNotReject(w.onPlace('place.submitted', placeEvent()));
  await assert.doesNotReject(w.onTour('tour.submitted', tourEvent()));
  assert.equal(hits.length, 6); // 3 attempts each
  assert.equal(w.published.length, 0);
  const placeCase = await w.caseOf('place', 'p1');
  const tourCase = await w.caseOf('tour', 't1');
  assert.equal(placeCase.status, 'ai_failed');
  assert.equal(tourCase.status, 'ai_failed');
  assert.match(placeCase.lastError, /timeout/);

  // An invalid payload can never succeed: dropped (acked) without an AI call.
  hits = [];
  await assert.doesNotReject(w.onPlace('place.submitted', placeEvent({ name: '' })));
  await assert.doesNotReject(w.onTour('tour.submitted', tourEvent({ revision: 'not-a-date' })));
  assert.equal(hits.length, 0);
  assert.equal(w.published.length, 0);
});
