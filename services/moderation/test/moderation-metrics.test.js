// ModerationMetrics port calls (deployment task 4.4): case flow, sweeper use-case and sweeper timer, with a fake
// metrics port, in-memory repo, fake AI and contract-validating fake publisher. No network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunPlaceReview } from '../src/application/use-cases/run-place-review.js';
import { RunTourReview } from '../src/application/use-cases/run-tour-review.js';
import { RetryFailedCases } from '../src/application/use-cases/retry-failed-cases.js';
import { aiFailureReason, caseSeconds } from '../src/application/use-cases/review-case-flow.js';
import { startRetrySweeper } from '../src/interfaces/jobs/retry-sweeper.js';
import { AiPermanentError, AiTemporaryError } from '../src/domain/errors/index.js';
import { NOOP_MODERATION_METRICS } from '../src/domain/ports/index.js';
import { InMemoryModerationRepository } from './helpers/in-memory-moderation-repository.js';
import { FakeAiReviewer, FakeClock, FakeLogger, FakePublisher } from './helpers/fakes.js';

const REV = '2026-01-01T00:00:00.000Z';
const MIN = 60_000;

class FakeMetrics {
  constructor() { this.finished = []; this.failed = []; this.pending = []; }
  caseFinished(e) { this.finished.push(e); }
  aiFailed(e) { this.failed.push(e); }
  setPending(n) { this.pending.push(n); }
}

const place = (over = {}) => ({
  placeId: 'p1', tourId: 't1', contributorId: 'u1', revision: REV,
  name: 'Ben Thanh Market', description: 'A historic market.', language: 'vi', lat: 10.77, lng: 106.69, ...over,
});
// near/far: about 3.3 km apart, a G3 long-leg Warning for walking; near/close: no geo finding.
const near = { placeId: 'pA', name: 'Ben Thanh Market', description: 'Market.', lat: 10.77, lng: 106.69, sequence: 0 };
const far = { placeId: 'pB', name: 'Tan Dinh Church', description: 'Pink church.', lat: 10.80, lng: 106.69, sequence: 1 };
const close = { placeId: 'pB', name: 'Opera House', description: 'Theatre.', lat: 10.78, lng: 106.69, sequence: 1 };
const tour = (over = {}) => ({
  tourId: 't1', contributorId: 'u1', revision: REV, title: 'Saigon walk', description: 'A walk.', language: 'vi',
  city: 'HCM', type: 'walking', durationMinutes: 120, places: [near, close], ...over,
});
const aiResult = (over = {}) => ({ verdict: 'Pass', severity: 0.1, reasons: [], imagesChecked: 0, model: 'gemini-2.5-flash', ...over });
const aiReason = { field: 'description', category: 'scam', message: 'Scam.', source: 'ai' };

function setup(responder = () => aiResult()) {
  const clock = new FakeClock();
  const repo = new InMemoryModerationRepository({ clock });
  const ai = new FakeAiReviewer(responder);
  const publisher = new FakePublisher();
  const logger = new FakeLogger();
  const metrics = new FakeMetrics();
  const deps = { repo, aiReviewer: ai, publisher, clock, logger, metrics };
  return { clock, repo, ai, publisher, logger, metrics, runPlace: new RunPlaceReview(deps), runTour: new RunTourReview(deps) };
}

test('place Pass: caseFinished once with kind place, verdict Pass, source ai, seconds from the event at', async () => {
  const { runPlace, metrics, publisher } = setup();
  await runPlace.execute(place({ at: '2025-12-31T23:59:30.000Z' })); // 30 s before the fake clock
  assert.equal(publisher.events.length, 1);
  assert.deepEqual(metrics.finished, [{ kind: 'place', verdict: 'Pass', source: 'ai', seconds: 30 }]);
  assert.deepEqual(metrics.failed, []);
});

test('without at, seconds run from the case creation to the published result', async () => {
  const { runPlace, metrics, clock } = setup(() => { clock.advance(5000); return aiResult(); });
  await runPlace.execute(place());
  assert.equal(metrics.finished[0].seconds, 5);
});

test('tour Warning from geo only (AI Pass): source geo', async () => {
  const { runTour, metrics, publisher } = setup();
  await runTour.execute(tour({ places: [near, far] }));
  assert.equal(publisher.events[0].payload.warning, true);
  assert.deepEqual(metrics.finished, [{ kind: 'tour', verdict: 'Warning', source: 'geo', seconds: 0 }]);
});

test('tour: AI and geo both Warning gives source ai (tie rule)', async () => {
  const { runTour, metrics } = setup(() => aiResult({ verdict: 'Warning', severity: 0.5, reasons: [{ ...aiReason, category: 'misleading' }] }));
  await runTour.execute(tour({ places: [near, far] }));
  assert.equal(metrics.finished[0].verdict, 'Warning');
  assert.equal(metrics.finished[0].source, 'ai');
});

test('place Reject: caseFinished with verdict Reject, source ai', async () => {
  const { runPlace, metrics, publisher } = setup(() => aiResult({ verdict: 'Reject', severity: 0.9, reasons: [aiReason] }));
  await runPlace.execute(place());
  assert.equal(publisher.events[0].eventName, 'place.ai_rejected');
  assert.deepEqual(metrics.finished.map(({ kind, verdict, source }) => ({ kind, verdict, source })), [
    { kind: 'place', verdict: 'Reject', source: 'ai' },
  ]);
});

test('503 after retries: aiFailed reason 503, no caseFinished, nothing published', async () => {
  const { runPlace, metrics, publisher, repo } = setup(() => {
    throw new AiTemporaryError('AI service answered 503', { status: 503, kind: 'server' });
  });
  await runPlace.execute(place());
  assert.deepEqual(metrics.failed, [{ kind: 'place', reason: '503' }]);
  assert.deepEqual(metrics.finished, []);
  assert.equal(publisher.events.length, 0);
  assert.equal(await repo.countByStatus('ai_failed'), 1);
});

test('422 is a finished case (Warning for human review), not an AI failure', async () => {
  const { runTour, metrics } = setup(() => {
    throw new AiPermanentError('AI service rejected the input (422)', { status: 422, kind: 'invalid_input' });
  });
  await runTour.execute(tour());
  assert.deepEqual(metrics.failed, []);
  assert.deepEqual(metrics.finished.map((e) => [e.kind, e.verdict, e.source]), [['tour', 'Warning', 'ai']]);
});

test('a duplicate event re-publishes the stored result without counting the case again', async () => {
  const { runPlace, metrics, publisher } = setup();
  await runPlace.execute(place());
  await runPlace.execute(place());
  assert.equal(publisher.events.length, 2);
  assert.equal(metrics.finished.length, 1);
});

test('a failed publish still counts the finished case once; the sweeper re-publish does not count it again', async () => {
  const { runPlace, metrics, publisher, repo, clock } = setup();
  publisher.failNext = 1;
  await runPlace.execute(place());
  assert.equal(publisher.events.length, 0);
  assert.equal(metrics.finished.length, 1);
  clock.advance(20 * MIN);
  const sweeper = new RetryFailedCases({
    repo, runPlaceReview: runPlace, clock, logger: new FakeLogger(), config: { failedAfterMs: 5 * MIN, staleAfterMs: 10 * MIN },
  });
  assert.equal((await sweeper.execute()).republished, 1);
  assert.equal(metrics.finished.length, 1);
});

test('a sweeper retry that succeeds counts the case once, with the time since the event', async () => {
  let down = true;
  const { runPlace, metrics, repo, clock } = setup(() => {
    if (down) throw new AiTemporaryError('AI service timed out after 10 ms', { kind: 'timeout' });
    return aiResult();
  });
  await runPlace.execute(place({ at: REV }));
  assert.deepEqual(metrics.failed, [{ kind: 'place', reason: 'timeout' }]);
  down = false;
  clock.advance(6 * MIN);
  const sweeper = new RetryFailedCases({
    repo, runPlaceReview: runPlace, clock, logger: new FakeLogger(), config: { failedAfterMs: 5 * MIN },
  });
  assert.equal(await sweeper.countPending(), 1);
  assert.equal((await sweeper.execute()).retried, 1);
  assert.equal(await sweeper.countPending(), 0);
  assert.deepEqual(metrics.finished, [{ kind: 'place', verdict: 'Pass', source: 'ai', seconds: 360 }]);
});

test('a throwing metrics port never breaks the case flow', async () => {
  const { runPlace, publisher, repo, metrics, logger } = setup();
  metrics.caseFinished = () => { throw new Error('boom'); };
  await assert.doesNotReject(runPlace.execute(place()));
  assert.equal(publisher.events.length, 1);
  assert.equal((await repo.find({ subjectType: 'place', subjectId: 'p1', revision: REV })).status, 'done');
  assert.ok(logger.lines.some(([level, m]) => level === 'warn' && /metrics update failed/.test(m)));
});

test('use-cases built without metrics use the no-op port', () => {
  const { repo, ai, publisher, clock, logger } = setup();
  const uc = new RunPlaceReview({ repo, aiReviewer: ai, publisher, clock, logger });
  assert.equal(uc.metrics, NOOP_MODERATION_METRICS);
});

test('aiFailureReason maps reviewer errors to timeout, 503, 401, other', () => {
  const t = (status, kind) => new AiTemporaryError('x', { status, kind });
  assert.equal(aiFailureReason(t(undefined, 'timeout')), 'timeout');
  assert.equal(aiFailureReason(t(503, 'server')), '503');
  assert.equal(aiFailureReason(t(401, 'config')), '401');
  assert.equal(aiFailureReason(t(500, 'server')), 'other');
  assert.equal(aiFailureReason(t(429, 'rate_limit')), 'other');
  assert.equal(aiFailureReason(t(undefined, 'network')), 'other');
  assert.equal(aiFailureReason(t(200, 'malformed')), 'other');
});

test('caseSeconds: event at first, then createdAt, never negative', () => {
  const now = new Date('2026-01-01T00:01:00.000Z');
  assert.equal(caseSeconds({ at: '2026-01-01T00:00:00.000Z' }, { createdAt: new Date('2026-01-01T00:00:50.000Z') }, now), 60);
  assert.equal(caseSeconds({}, { createdAt: new Date('2026-01-01T00:00:50.000Z') }, now), 10);
  assert.equal(caseSeconds({ at: 'not a date' }, { createdAt: new Date('2026-01-01T00:00:50.000Z') }, now), 10);
  assert.equal(caseSeconds({ at: '2026-01-01T00:02:00.000Z' }, null, now), 0);
  assert.equal(caseSeconds({}, {}, now), null);
});

function fakeTimers() {
  const t = { fn: null };
  t.setIntervalImpl = (fn) => { t.fn = fn; return { id: 'timer' }; };
  t.clearIntervalImpl = () => {};
  return t;
}

test('sweeper tick: setPending with the repository count of ai_failed cases, on every tick', async () => {
  const { repo } = setup();
  const a = await repo.createPending({ subjectType: 'place', subjectId: 'p1', revision: 'r1', payload: {} });
  await repo.createPending({ subjectType: 'place', subjectId: 'p2', revision: 'r1', payload: {} });
  await repo.update(a.id, { status: 'ai_failed' });
  const retryFailedCases = { execute: async () => ({}), countPending: async () => repo.countByStatus('ai_failed') };
  const metrics = new FakeMetrics();
  const timers = fakeTimers();
  startRetrySweeper({ retryFailedCases, intervalMs: 10, logger: new FakeLogger(), metrics, ...timers });
  await timers.fn();
  assert.deepEqual(metrics.pending, [1]);
  await repo.update(a.id, { status: 'done' });
  await timers.fn();
  assert.deepEqual(metrics.pending, [1, 0]);
});

test('sweeper tick: the gauge is set even when the lock skips the sweep (other replica sweeps)', async () => {
  const metrics = new FakeMetrics();
  const timers = fakeTimers();
  let swept = 0;
  startRetrySweeper({
    retryFailedCases: { execute: async () => { swept += 1; }, countPending: async () => 4 },
    intervalMs: 10, logger: new FakeLogger(), metrics, lock: async () => 'skipped', ...timers,
  });
  await timers.fn();
  assert.equal(swept, 0);
  assert.deepEqual(metrics.pending, [4]);
});

test('sweeper tick: a count failure is logged and swallowed; no count method means no gauge update', async () => {
  const metrics = new FakeMetrics();
  const logger = new FakeLogger();
  const timers = fakeTimers();
  startRetrySweeper({
    retryFailedCases: { execute: async () => ({}), countPending: async () => { throw new Error('db down'); } },
    intervalMs: 10, logger, metrics, ...timers,
  });
  await assert.doesNotReject(timers.fn());
  assert.deepEqual(metrics.pending, []);
  assert.ok(logger.lines.some(([level, m]) => level === 'error' && /count pending cases: db down/.test(m)));

  const other = fakeTimers();
  startRetrySweeper({ retryFailedCases: { execute: async () => ({}) }, intervalMs: 10, logger, metrics, ...other });
  await other.fn();
  assert.deepEqual(metrics.pending, []);
});
