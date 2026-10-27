// RetryFailedCases sweeper use-case (tasks #AI-38, #AI-37): fake clock, in-memory repo, fake AI, contract-validating
// fake publisher. No network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RetryFailedCases, DEFAULT_BATCH_SIZE } from '../src/application/use-cases/retry-failed-cases.js';
import { RunPlaceReview, STALE_REVIEWING_ERROR } from '../src/application/use-cases/run-place-review.js';
import { RunTourReview } from '../src/application/use-cases/run-tour-review.js';
import { AiPermanentError, AiTemporaryError } from '../src/domain/errors/index.js';
import { InMemoryModerationRepository } from './helpers/in-memory-moderation-repository.js';
import { FakeAiReviewer, FakeClock, FakeLogger, FakePublisher } from './helpers/fakes.js';

const MIN = 60_000;
const FAILED_AFTER = 5 * MIN;
const STALE_AFTER = 10 * MIN;
const REV = '2026-01-01T00:00:00.000Z';

const place = (placeId = 'p1', over = {}) => ({
  placeId, tourId: 't1', contributorId: 'u1', revision: REV,
  name: 'Ben Thanh Market', description: 'A historic market.', language: 'vi', lat: 10.77, lng: 106.69, ...over,
});
const aiResult = (over = {}) => ({ verdict: 'Pass', severity: 0.1, reasons: [], imagesChecked: 0, model: 'gemini-2.5-flash', ...over });
const temporary = () => new AiTemporaryError('AI service answered 503', { status: 503, kind: 'server' });
const zero = { retried: 0, republished: 0, skipped: 0, failed: 0 };

// `ai.mode` switches the fake AI: 'ok' | 'down' | 'invalid' (422).
function setup({ staleAfterMs = STALE_AFTER } = {}) {
  const clock = new FakeClock();
  const repo = new InMemoryModerationRepository({ clock });
  const ai = new FakeAiReviewer(() => {
    if (ai.mode === 'down') throw temporary();
    if (ai.mode === 'invalid') throw new AiPermanentError('AI service rejected the input (422)', { status: 422, kind: 'invalid_input' });
    return aiResult();
  });
  ai.mode = 'ok';
  const publisher = new FakePublisher();
  const logger = new FakeLogger();
  const runPlaceReview = new RunPlaceReview({ repo, aiReviewer: ai, publisher, clock, logger });
  const runTourReview = new RunTourReview({ repo, aiReviewer: ai, publisher, clock, logger });
  const sweeper = new RetryFailedCases({
    repo, runPlaceReview, runTourReview, clock, logger,
    config: { failedAfterMs: FAILED_AFTER, staleAfterMs, batchSize: 50 },
  });
  const caseOf = (placeId = 'p1') => repo.find({ subjectType: 'place', subjectId: placeId, revision: REV });
  const tourCaseOf = (tourId = 'tour1') => repo.find({ subjectType: 'tour', subjectId: tourId, revision: REV });
  return { clock, repo, ai, publisher, logger, runPlaceReview, runTourReview, sweeper, caseOf, tourCaseOf };
}

// A place case left ai_failed by the normal flow (AI down during the consumer run).
async function aiFailedCase(ctx, placeId = 'p1') {
  ctx.ai.mode = 'down';
  await ctx.runPlaceReview.execute(place(placeId));
  ctx.ai.mode = 'ok';
  assert.equal((await ctx.caseOf(placeId)).status, 'ai_failed');
}

test('ai_failed older than the cutoff is retried from the stored payload and published once', async () => {
  const ctx = setup();
  await aiFailedCase(ctx);
  ctx.clock.advance(FAILED_AFTER + 1);

  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, retried: 1 });
  assert.equal(ctx.ai.calls.length, 2);
  assert.deepEqual(ctx.ai.calls[1], ['place', place()]);
  assert.equal(ctx.publisher.events.length, 1);
  assert.equal(ctx.publisher.events[0].eventName, 'place.ai_passed');
  assert.equal(ctx.publisher.events[0].payload.placeId, 'p1');
  const c = await ctx.caseOf();
  assert.equal(c.status, 'done');
  assert.equal(c.attempts, 2);
  assert.ok(c.publishedAt instanceof Date);

  // Later sweeps find nothing: still exactly one publish.
  ctx.clock.advance(STALE_AFTER * 3);
  assert.deepEqual(await ctx.sweeper.execute(), zero);
  assert.equal(ctx.publisher.events.length, 1);
  assert.equal(ctx.ai.calls.length, 2);
});

test('ai_failed younger than the cutoff is not retried', async () => {
  const ctx = setup();
  await aiFailedCase(ctx);
  ctx.clock.advance(FAILED_AFTER - 1);
  assert.deepEqual(await ctx.sweeper.execute(), zero);
  assert.equal(ctx.ai.calls.length, 1);
  assert.equal((await ctx.caseOf()).status, 'ai_failed');
});

test('stale pending case (crash before the AI call) is retried; not before staleAfterMs', async () => {
  const ctx = setup();
  await ctx.repo.createPending({ subjectType: 'place', subjectId: 'p1', tourId: 't1', revision: REV, payload: place() });

  ctx.clock.advance(FAILED_AFTER + 1); // old enough for ai_failed, not for pending
  assert.deepEqual(await ctx.sweeper.execute(), zero);

  ctx.clock.advance(STALE_AFTER);
  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, retried: 1 });
  assert.deepEqual(ctx.ai.calls, [['place', place()]]);
  assert.equal(ctx.publisher.events.length, 1);
  const c = await ctx.caseOf();
  assert.equal(c.status, 'done');
  assert.equal(c.attempts, 1);
});

test('stale reviewing case (crash during the AI call) goes reviewing -> ai_failed -> reviewing -> done', async () => {
  const ctx = setup();
  const created = await ctx.repo.createPending({ subjectType: 'place', subjectId: 'p1', tourId: 't1', revision: REV, payload: place() });
  await ctx.repo.update(created.id, { status: 'reviewing', attempts: 1 });
  ctx.clock.advance(STALE_AFTER + 1);

  // Record the status path through claim().
  const path = [];
  const claim = ctx.repo.claim.bind(ctx.repo);
  ctx.repo.claim = async (id, opts) => {
    const row = await claim(id, opts);
    if (row) path.push(`${opts.fromStatus}>${row.status}`);
    return row;
  };

  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, retried: 1 });
  assert.deepEqual(path, ['reviewing>ai_failed', 'ai_failed>reviewing']);
  assert.equal(ctx.publisher.events.length, 1);
  const c = await ctx.caseOf();
  assert.equal(c.status, 'done');
  assert.equal(c.attempts, 2);
  assert.equal(c.lastError, null);
});

test('stale reviewing whose AI is still down stays ai_failed with the AI error', async () => {
  const ctx = setup();
  const created = await ctx.repo.createPending({ subjectType: 'place', subjectId: 'p1', tourId: 't1', revision: REV, payload: place() });
  await ctx.repo.update(created.id, { status: 'reviewing', attempts: 1 });
  ctx.clock.advance(STALE_AFTER + 1);
  ctx.ai.mode = 'down';
  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, failed: 1 });
  const c = await ctx.caseOf();
  assert.equal(c.status, 'ai_failed');
  assert.notEqual(c.lastError, STALE_REVIEWING_ERROR);
  assert.match(c.lastError, /503/);
});

test('done but unpublished is re-published without an AI call', async () => {
  const ctx = setup();
  ctx.publisher.failNext = 1;
  await ctx.runPlaceReview.execute(place());
  assert.equal((await ctx.caseOf()).publishedAt, null);
  ctx.clock.advance(STALE_AFTER + 1);

  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, republished: 1 });
  assert.equal(ctx.ai.calls.length, 1);
  assert.equal(ctx.publisher.events.length, 1);
  assert.equal(ctx.publisher.events[0].eventName, 'place.ai_passed');
  assert.equal(ctx.publisher.events[0].payload.warning, false);
  const c = await ctx.caseOf();
  assert.equal(c.status, 'done');
  assert.ok(c.publishedAt instanceof Date);

  ctx.clock.advance(STALE_AFTER * 3);
  assert.deepEqual(await ctx.sweeper.execute(), zero);
  assert.equal(ctx.publisher.events.length, 1);
});

test('failed_permanent but unpublished is re-published as a Warning without an AI call', async () => {
  const ctx = setup();
  ctx.ai.mode = 'invalid';
  ctx.publisher.failNext = 1;
  await ctx.runPlaceReview.execute(place());
  assert.equal((await ctx.caseOf()).status, 'failed_permanent');
  ctx.clock.advance(STALE_AFTER + 1);

  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, republished: 1 });
  assert.equal(ctx.ai.calls.length, 1);
  assert.equal(ctx.publisher.events.length, 1);
  const { eventName, payload } = ctx.publisher.events[0];
  assert.equal(eventName, 'place.ai_passed');
  assert.equal(payload.warning, true);
  assert.equal(payload.severity, 0.5);
  assert.ok((await ctx.caseOf()).publishedAt instanceof Date);
});

test('re-publish failing again counts as failed and is tried again on a later sweep', async () => {
  const ctx = setup();
  ctx.publisher.failNext = 1;
  await ctx.runPlaceReview.execute(place());
  ctx.clock.advance(STALE_AFTER + 1);
  ctx.publisher.failNext = 1;
  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, failed: 1 });
  assert.equal(ctx.publisher.events.length, 0);
  assert.deepEqual(await ctx.sweeper.execute(), zero, 'the lease refreshed updatedAt');
  ctx.clock.advance(STALE_AFTER + 1);
  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, republished: 1 });
  assert.equal(ctx.publisher.events.length, 1);
});

test('AI still down: case stays ai_failed, nothing published, attempts incremented, no throw', async () => {
  const ctx = setup();
  await aiFailedCase(ctx);
  ctx.clock.advance(FAILED_AFTER + 1);
  ctx.ai.mode = 'down';

  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, failed: 1 });
  assert.equal(ctx.publisher.events.length, 0);
  let c = await ctx.caseOf();
  assert.equal(c.status, 'ai_failed');
  assert.equal(c.attempts, 2);
  assert.match(c.lastError, /503/);

  // updatedAt was refreshed: not retried again before the cutoff, retried after it.
  assert.deepEqual(await ctx.sweeper.execute(), zero);
  ctx.clock.advance(FAILED_AFTER + 1);
  ctx.ai.mode = 'ok';
  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, retried: 1 });
  c = await ctx.caseOf();
  assert.equal(c.status, 'done');
  assert.equal(c.attempts, 3);
  assert.equal(ctx.publisher.events.length, 1);
});

test('two concurrent sweeps process each case once (compare-and-set claim)', async () => {
  const ctx = setup();
  await aiFailedCase(ctx, 'failed1');
  await aiFailedCase(ctx, 'failed2');
  const reviewing = await ctx.repo.createPending({ subjectType: 'place', subjectId: 'stuck', tourId: 't1', revision: REV, payload: place('stuck') });
  await ctx.repo.update(reviewing.id, { status: 'reviewing', attempts: 1 });
  ctx.publisher.failNext = 1;
  await ctx.runPlaceReview.execute(place('unpublished'));
  ctx.clock.advance(STALE_AFTER + 1);
  const aiCallsBefore = ctx.ai.calls.length;

  const other = new RetryFailedCases({
    repo: ctx.repo, runPlaceReview: ctx.runPlaceReview, clock: ctx.clock, logger: ctx.logger,
    config: { failedAfterMs: FAILED_AFTER, staleAfterMs: STALE_AFTER },
  });
  const [a, b] = await Promise.all([ctx.sweeper.execute(), other.execute()]);

  assert.equal(a.retried + b.retried, 3);
  assert.equal(a.republished + b.republished, 1);
  assert.equal(a.skipped + b.skipped, 4, 'every case seen by both sweeps is skipped by the loser');
  assert.equal(a.failed + b.failed, 0);
  assert.equal(ctx.ai.calls.length - aiCallsBefore, 3);
  const published = ctx.publisher.events.map((e) => e.payload.placeId).sort();
  assert.deepEqual(published, ['failed1', 'failed2', 'stuck', 'unpublished']);
});

test('a sweep and a consumer redelivery never review the same case twice', async () => {
  const ctx = setup();
  await aiFailedCase(ctx);
  ctx.clock.advance(FAILED_AFTER + 1);
  await Promise.all([ctx.sweeper.execute(), ctx.runPlaceReview.execute(place())]);
  assert.equal(ctx.ai.calls.length, 2);
  assert.equal(ctx.publisher.events.length, 1);
  assert.equal((await ctx.caseOf()).attempts, 2);
});

const tour = (tourId = 'tour1') => ({
  tourId, contributorId: 'u1', revision: REV, title: 'Saigon walk', language: 'vi', type: 'walking',
  places: [{ placeId: 'p1', name: 'Ben Thanh Market', description: 'Market.', lat: 10.77, lng: 106.69, sequence: 0 }],
});

test('tour ai_failed case is retried through RunTourReview and publishes tour.ai_passed once', async () => {
  const ctx = setup();
  ctx.ai.mode = 'down';
  await ctx.runTourReview.execute(tour());
  ctx.ai.mode = 'ok';
  assert.equal((await ctx.tourCaseOf()).status, 'ai_failed');
  ctx.clock.advance(FAILED_AFTER + 1);

  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, retried: 1 });
  assert.deepEqual(ctx.ai.calls.map(([kind]) => kind), ['tour', 'tour'], 'never a place call');
  assert.equal(ctx.publisher.events.length, 1);
  assert.equal(ctx.publisher.events[0].eventName, 'tour.ai_passed');
  assert.equal(ctx.publisher.events[0].payload.tourId, 'tour1');
  const c = await ctx.tourCaseOf();
  assert.equal(c.status, 'done');
  assert.equal(c.attempts, 2);
});

test('tour done but unpublished is re-published without an AI call', async () => {
  const ctx = setup();
  ctx.publisher.failNext = 1;
  await ctx.runTourReview.execute(tour());
  assert.equal((await ctx.tourCaseOf()).publishedAt, null);
  ctx.clock.advance(STALE_AFTER + 1);

  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, republished: 1 });
  assert.equal(ctx.ai.calls.length, 1);
  assert.equal(ctx.publisher.events.length, 1);
  assert.equal(ctx.publisher.events[0].eventName, 'tour.ai_passed');
  assert.ok((await ctx.tourCaseOf()).publishedAt instanceof Date);
});

test('a case whose subject type has no reviewer is skipped with a warning', async () => {
  const ctx = setup();
  const sweeper = new RetryFailedCases({
    repo: ctx.repo, runPlaceReview: ctx.runPlaceReview, clock: ctx.clock, logger: ctx.logger,
    config: { failedAfterMs: FAILED_AFTER, staleAfterMs: STALE_AFTER },
  });
  await ctx.repo.createPending({ subjectType: 'tour', subjectId: 'tour1', revision: REV, payload: tour() });
  ctx.clock.advance(STALE_AFTER + 1);
  assert.deepEqual(await sweeper.execute(), { ...zero, skipped: 1 });
  assert.equal(ctx.ai.calls.length, 0);
  assert.equal((await ctx.tourCaseOf()).status, 'pending');
  assert.ok(ctx.logger.lines.some(([level, m]) => level === 'warn' && /tour1/.test(m)));
});

test('cutoffs and batch size are passed to listRetryable; staleAfterMs defaults to failedAfterMs', async () => {
  const clock = new FakeClock();
  const seen = [];
  const repo = { async listRetryable(opts) { seen.push(opts); return []; } };
  const now = clock.now().getTime();
  await new RetryFailedCases({ repo, runPlaceReview: {}, clock, logger: new FakeLogger(), config: { failedAfterMs: 1000, staleAfterMs: 2000, batchSize: 7 } }).execute();
  await new RetryFailedCases({ repo, runPlaceReview: {}, clock, logger: new FakeLogger(), config: { failedAfterMs: 1000 } }).execute();
  assert.deepEqual(seen, [
    { failedBefore: new Date(now - 1000), staleBefore: new Date(now - 2000), limit: 7 },
    { failedBefore: new Date(now - 1000), staleBefore: new Date(now - 1000), limit: DEFAULT_BATCH_SIZE },
  ]);
});

test('repository errors are logged and never thrown', async () => {
  const logger = new FakeLogger();
  const repo = { async listRetryable() { throw new Error('db down'); } };
  const uc = new RetryFailedCases({ repo, runPlaceReview: {}, clock: new FakeClock(), logger, config: { failedAfterMs: 1 } });
  assert.deepEqual(await uc.execute(), zero);
  assert.ok(logger.lines.some(([level, m]) => level === 'error' && /db down/.test(m)));
});

test('a claim error on one case is counted as failed and the batch goes on', async () => {
  const ctx = setup();
  await aiFailedCase(ctx, 'a');
  await aiFailedCase(ctx, 'b');
  ctx.clock.advance(FAILED_AFTER + 1);
  const claim = ctx.repo.claim.bind(ctx.repo);
  let first = true;
  ctx.repo.claim = async (id, opts) => {
    if (first) { first = false; throw new Error('db hiccup'); }
    return claim(id, opts);
  };
  assert.deepEqual(await ctx.sweeper.execute(), { ...zero, retried: 1, failed: 1 });
  assert.equal(ctx.publisher.events.length, 1);
  assert.ok(ctx.logger.lines.some(([level, m]) => level === 'error' && /db hiccup/.test(m)));
});
