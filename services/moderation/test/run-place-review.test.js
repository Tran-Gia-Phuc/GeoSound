// RunPlaceReview use-case (task #AI-36): in-memory repo, fake AI, contract-validating fake publisher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunPlaceReview, REJECT_FALLBACK_REASON } from '../src/application/use-cases/run-place-review.js';
import { AiPermanentError, AiTemporaryError } from '../src/domain/errors/index.js';
import { InMemoryModerationRepository } from './helpers/in-memory-moderation-repository.js';
import { FakeAiReviewer, FakeClock, FakeLogger, FakePublisher } from './helpers/fakes.js';

const REV = '2026-01-01T00:00:00.000Z';
const REV2 = '2026-01-02T00:00:00.000Z';

const place = (over = {}) => ({
  placeId: 'p1', tourId: 't1', contributorId: 'u1', revision: REV,
  name: 'Ben Thanh Market', description: 'A historic market.', language: 'vi',
  lat: 10.77, lng: 106.69, ...over,
});

const aiReason = (over = {}) => ({ field: 'description', category: 'misleading', message: 'Looks misleading.', source: 'ai', ...over });
const aiResult = (over = {}) => ({ verdict: 'Pass', severity: 0.1, reasons: [], imagesChecked: 0, model: 'gemini-2.5-flash', ...over });

function setup(responder) {
  const clock = new FakeClock();
  const repo = new InMemoryModerationRepository({ clock });
  const ai = new FakeAiReviewer(responder);
  const publisher = new FakePublisher();
  const logger = new FakeLogger();
  const uc = new RunPlaceReview({ repo, aiReviewer: ai, publisher, clock, logger });
  const caseOf = (revision = REV) => repo.find({ subjectType: 'place', subjectId: 'p1', revision });
  return { clock, repo, ai, publisher, logger, uc, caseOf };
}

test('Pass publishes place.ai_passed with warning false and marks the case done', async () => {
  const { uc, ai, publisher, caseOf } = setup(() => aiResult());
  await uc.execute(place());
  assert.equal(ai.calls.length, 1);
  assert.equal(publisher.events.length, 1);
  const { eventName, payload } = publisher.events[0];
  assert.equal(eventName, 'place.ai_passed');
  assert.equal(payload.warning, false);
  assert.equal(payload.placeId, 'p1');
  assert.equal(payload.tourId, 't1');
  assert.equal(payload.revision, REV);
  assert.equal(payload.severity, 0.1);
  assert.match(payload.at, /Z$/);
  const c = await caseOf();
  assert.equal(c.status, 'done');
  assert.equal(c.verdict, 'Pass');
  assert.equal(c.model, 'gemini-2.5-flash');
  assert.equal(c.attempts, 1);
  assert.ok(c.checkedAt instanceof Date);
  assert.ok(c.publishedAt instanceof Date);
  assert.equal(c.payload.name, 'Ben Thanh Market');
});

test('Warning publishes place.ai_passed with warning true and reasons tagged source ai', async () => {
  const { uc, publisher, caseOf } = setup(() => aiResult({ verdict: 'Warning', severity: 0.55, reasons: [aiReason({ source: undefined })] }));
  await uc.execute(place());
  const { eventName, payload } = publisher.events[0];
  assert.equal(eventName, 'place.ai_passed');
  assert.equal(payload.warning, true);
  assert.equal(payload.severity, 0.55);
  assert.deepEqual(payload.reasons, [aiReason()]);
  assert.equal((await caseOf()).verdict, 'Warning');
});

test('Reject publishes place.ai_rejected with reasons joined into reason (max 1000)', async () => {
  const long = 'x'.repeat(400);
  const reasons = [aiReason({ message: long }), aiReason({ category: 'scam', message: long }), aiReason({ category: 'hate', message: long })];
  const { uc, publisher, caseOf } = setup(() => aiResult({ verdict: 'Reject', severity: 0.9, reasons }));
  await uc.execute(place());
  const { eventName, payload } = publisher.events[0];
  assert.equal(eventName, 'place.ai_rejected');
  assert.equal(payload.reason.length, 1000);
  assert.ok(payload.reason.startsWith(`${long}; ${long}; `));
  assert.equal(payload.reasons.length, 3);
  assert.equal(payload.warning, undefined);
  assert.equal((await caseOf()).verdict, 'Reject');
});

test('Reject without reasons uses the fallback reason', async () => {
  const { uc, publisher } = setup(() => aiResult({ verdict: 'Reject', severity: 0.85, reasons: [] }));
  await uc.execute(place());
  assert.equal(publisher.events[0].payload.reason, REJECT_FALLBACK_REASON);
});

test('duplicate revision re-publishes the stored result without a second AI call', async () => {
  const { uc, ai, publisher } = setup(() => aiResult({ verdict: 'Warning', severity: 0.5, reasons: [aiReason()] }));
  await uc.execute(place());
  await uc.execute(place());
  assert.equal(ai.calls.length, 1);
  assert.equal(publisher.events.length, 2);
  const [a, b] = publisher.events;
  assert.equal(b.eventName, a.eventName);
  assert.deepEqual({ ...b.payload, at: undefined }, { ...a.payload, at: undefined });
});

test('a new revision creates a new case and calls the AI again', async () => {
  const { uc, ai, publisher, caseOf } = setup(() => aiResult());
  await uc.execute(place());
  await uc.execute(place({ revision: REV2 }));
  assert.equal(ai.calls.length, 2);
  assert.equal(publisher.events.length, 2);
  assert.equal(publisher.events[1].payload.revision, REV2);
  assert.notEqual((await caseOf(REV)).id, (await caseOf(REV2)).id);
});

test('AI temporary failure leaves ai_failed, publishes nothing and does not throw', async () => {
  const { uc, publisher, caseOf } = setup(() => { throw new AiTemporaryError('AI service answered 503', { status: 503, kind: 'server' }); });
  await uc.execute(place());
  assert.equal(publisher.events.length, 0);
  const c = await caseOf();
  assert.equal(c.status, 'ai_failed');
  assert.match(c.lastError, /503/);
  assert.equal(c.publishedAt, null);
});

test('AI 401 config error leaves ai_failed and publishes nothing', async () => {
  const { uc, publisher, caseOf } = setup(() => { throw new AiTemporaryError('AI service rejected the internal token (401)', { status: 401, kind: 'config' }); });
  await uc.execute(place());
  assert.equal(publisher.events.length, 0);
  const c = await caseOf();
  assert.equal(c.status, 'ai_failed');
  assert.match(c.lastError, /config/);
});

test('an ai_failed case is reviewed again on redelivery', async () => {
  let fail = true;
  const { uc, ai, publisher, caseOf } = setup(() => {
    if (fail) throw new AiTemporaryError('timeout', { kind: 'timeout' });
    return aiResult();
  });
  await uc.execute(place());
  fail = false;
  await uc.execute(place());
  assert.equal(ai.calls.length, 2);
  assert.equal(publisher.events.length, 1);
  const c = await caseOf();
  assert.equal(c.status, 'done');
  assert.equal(c.attempts, 2);
});

test('AI 422 marks failed_permanent and publishes a Warning for human review', async () => {
  const { uc, ai, publisher, caseOf } = setup(() => { throw new AiPermanentError('AI service rejected the input (422)', { status: 422, kind: 'invalid_input' }); });
  await uc.execute(place());
  assert.equal(publisher.events.length, 1);
  const { eventName, payload } = publisher.events[0];
  assert.equal(eventName, 'place.ai_passed');
  assert.equal(payload.warning, true);
  assert.equal(payload.severity, 0.5);
  assert.deepEqual(payload.reasons, [{
    field: 'description', category: 'other', source: 'ai',
    message: 'Automatic check could not process this place; needs human review.',
  }]);
  assert.equal((await caseOf()).status, 'failed_permanent');

  // Duplicate of a failed_permanent case: same Warning again, no new AI call.
  await uc.execute(place());
  assert.equal(ai.calls.length, 1);
  assert.equal(publisher.events.length, 2);
  assert.equal(publisher.events[1].payload.warning, true);
});

test('more than 50 reasons are capped at 50 in the event', async () => {
  const reasons = Array.from({ length: 60 }, (_, i) => aiReason({ message: `finding ${i}` }));
  const { uc, publisher } = setup(() => aiResult({ verdict: 'Warning', severity: 0.6, reasons }));
  await uc.execute(place());
  assert.equal(publisher.events[0].payload.reasons.length, 50);
});

test('publish failure keeps the case done without publishedAt; a duplicate re-publishes it', async () => {
  const { uc, ai, publisher, caseOf } = setup(() => aiResult());
  publisher.failNext = 1;
  await uc.execute(place());
  let c = await caseOf();
  assert.equal(c.status, 'done');
  assert.equal(c.publishedAt, null);
  await uc.execute(place());
  assert.equal(ai.calls.length, 1);
  assert.equal(publisher.events.length, 1);
  c = await caseOf();
  assert.ok(c.publishedAt instanceof Date);
});

test('unexpected AI error is logged, case ai_failed, no throw', async () => {
  const { uc, publisher, logger, caseOf } = setup(() => { throw new TypeError('boom'); });
  await uc.execute(place());
  assert.equal(publisher.events.length, 0);
  assert.equal((await caseOf()).status, 'ai_failed');
  assert.ok(logger.lines.some(([level, m]) => level === 'error' && /boom/.test(m)));
});

test('repository failure is logged and never thrown', async () => {
  const { uc, ai, logger } = setup(() => aiResult());
  uc.repo.createPending = async () => { throw new Error('db down'); };
  await uc.execute(place());
  assert.equal(ai.calls.length, 0);
  assert.ok(logger.lines.some(([level, m]) => level === 'error' && /db down/.test(m)));
});

test('two concurrent deliveries of one revision call the AI once (compare-and-set claim, #AI-38)', async () => {
  const { uc, ai, publisher, logger, caseOf } = setup(() => aiResult());
  await Promise.all([uc.execute(place()), uc.execute(place())]);
  assert.equal(ai.calls.length, 1);
  assert.equal(publisher.events.length, 1);
  assert.equal((await caseOf()).attempts, 1);
  assert.ok(logger.lines.some(([level, m]) => level === 'info' && /claimed by another worker/.test(m)));
});
