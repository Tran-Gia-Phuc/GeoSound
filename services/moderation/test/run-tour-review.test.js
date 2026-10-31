// RunTourReview use-case (task #AI-37): in-memory repo, fake AI, contract-validating fake publisher.
// Geo rules run for real (pure domain code); no network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RunTourReview, TOUR_INCOMPLETE_REASON, isTourComplete, withPlaceIds,
} from '../src/application/use-cases/run-tour-review.js';
import { REJECT_FALLBACK_REASON } from '../src/application/use-cases/review-case-flow.js';
import { AiPermanentError, AiTemporaryError } from '../src/domain/errors/index.js';
import { InMemoryModerationRepository } from './helpers/in-memory-moderation-repository.js';
import { FakeAiReviewer, FakeClock, FakeLogger, FakePublisher } from './helpers/fakes.js';

const REV = '2026-01-01T00:00:00.000Z';
const REV2 = '2026-01-02T00:00:00.000Z';

// Two stops about 3.3 km apart: G3 long leg for walking (limit 3 km), nothing else.
const near = (over = {}) => ({ placeId: 'pA', name: 'Ben Thanh Market', description: 'Market.', lat: 10.77, lng: 106.69, sequence: 0, ...over });
const far = (over = {}) => ({ placeId: 'pB', name: 'Tan Dinh Church', description: 'Pink church.', lat: 10.80, lng: 106.69, sequence: 1, ...over });
// Two stops about 1.1 km apart: no geo finding.
const close = (over = {}) => ({ placeId: 'pB', name: 'Opera House', description: 'Theatre.', lat: 10.78, lng: 106.69, sequence: 1, ...over });

const tour = (over = {}) => ({
  tourId: 't1', contributorId: 'u1', revision: REV,
  title: 'Saigon walk', description: 'A walk through District 1.', language: 'vi', city: 'HCM',
  type: 'walking', durationMinutes: 120, places: [near(), close()], ...over,
});

const aiReason = (over = {}) => ({ field: 'description', category: 'misleading', message: 'Looks misleading.', source: 'ai', ...over });
const aiResult = (over = {}) => ({ verdict: 'Pass', severity: 0.1, reasons: [], model: 'gemini-2.5-flash', ...over });

function setup(responder = () => aiResult()) {
  const clock = new FakeClock();
  const repo = new InMemoryModerationRepository({ clock });
  const ai = new FakeAiReviewer(responder);
  const publisher = new FakePublisher();
  const logger = new FakeLogger();
  const uc = new RunTourReview({ repo, aiReviewer: ai, publisher, clock, logger });
  const caseOf = (revision = REV) => repo.find({ subjectType: 'tour', subjectId: 't1', revision });
  return { clock, repo, ai, publisher, logger, uc, caseOf };
}

test('AI Pass and no geo finding publishes tour.ai_passed with warning false and recipient keys', async () => {
  const { uc, ai, publisher, caseOf } = setup();
  await uc.execute(tour());
  assert.equal(ai.calls.length, 1);
  const { eventName, payload } = publisher.events[0];
  assert.equal(eventName, 'tour.ai_passed');
  assert.equal(payload.tourId, 't1');
  assert.equal(payload.revision, REV);
  assert.equal(payload.warning, false);
  assert.equal(payload.severity, 0.1);
  assert.deepEqual(payload.reasons, []);
  assert.equal(payload.contributorId, 'u1');
  assert.equal(payload.tourTitle, 'Saigon walk');
  assert.match(payload.at, /Z$/);
  const c = await caseOf();
  assert.equal(c.status, 'done');
  assert.equal(c.verdict, 'Pass');
  assert.equal(c.model, 'gemini-2.5-flash');
  assert.ok(c.publishedAt instanceof Date);
});

test('geo Warning + AI Pass gives tour.ai_passed warning true with both reasons (sources ai and geo)', async () => {
  const { uc, publisher } = setup(() => aiResult({ reasons: [aiReason({ severity: undefined, category: 'irrelevant', message: 'Minor note.' })] }));
  await uc.execute(tour({ places: [near(), far()] }));
  const { eventName, payload } = publisher.events[0];
  assert.equal(eventName, 'tour.ai_passed');
  assert.equal(payload.warning, true);
  assert.equal(payload.severity, 0.5);
  assert.deepEqual(payload.reasons.map((r) => r.source), ['ai', 'geo']);
  const geo = payload.reasons[1];
  assert.equal(geo.category, 'route');
  assert.equal(geo.field, 'places[1]');
  assert.match(geo.message, /\(placeId pB\)$/);
});

test('G1 invalid coordinate is published as tour.ai_rejected even when the AI passes', async () => {
  const { uc, ai, publisher, caseOf } = setup();
  await uc.execute(tour({ places: [near(), close({ lat: 0, lng: 0 })] }));
  assert.equal(ai.calls.length, 1);
  const { eventName, payload } = publisher.events[0];
  assert.equal(eventName, 'tour.ai_rejected');
  assert.match(payload.reason, /tọa độ không hợp lệ/); // the tour language is vi (#253)
  assert.match(payload.reason, /placeId pB/);
  assert.equal(payload.reasons[0].source, 'geo');
  assert.equal(payload.contributorId, 'u1');
  assert.equal(payload.tourTitle, 'Saigon walk');
  assert.equal(payload.warning, undefined);
  assert.equal((await caseOf()).verdict, 'Reject');
});

test('AI Reject publishes tour.ai_rejected with reasons joined into reason (max 1000)', async () => {
  const long = 'x'.repeat(600);
  const reasons = [aiReason({ message: long }), aiReason({ category: 'scam', field: 'title', message: long })];
  const { uc, publisher } = setup(() => aiResult({ verdict: 'Reject', severity: 0.9, reasons }));
  await uc.execute(tour());
  const { eventName, payload } = publisher.events[0];
  assert.equal(eventName, 'tour.ai_rejected');
  assert.equal(payload.reason.length, 1000);
  assert.ok(payload.reason.startsWith(`${long}; `));
  assert.equal(payload.reasons.length, 2);
  assert.ok(payload.reasons.every((r) => r.message.length <= 500));
});

test('AI Reject without reasons uses the fallback reason (never empty)', async () => {
  const { uc, publisher } = setup(() => aiResult({ verdict: 'Reject', severity: 0.9, reasons: [] }));
  await uc.execute(tour());
  assert.equal(publisher.events[0].payload.reason, REJECT_FALLBACK_REASON);
});

test('places are never sent to reviewPlace: one reviewTour call with the tour payload', async () => {
  const { uc, ai } = setup();
  const t = tour({ places: [near(), close(), far({ placeId: 'pC', sequence: 2 })] });
  await uc.execute(t);
  assert.deepEqual(ai.calls, [['tour', t]]);
});

test('duplicate revision re-publishes the stored result without a second AI call', async () => {
  const { uc, ai, publisher } = setup();
  await uc.execute(tour());
  await uc.execute(tour());
  assert.equal(ai.calls.length, 1);
  assert.equal(publisher.events.length, 2);
  assert.deepEqual(publisher.events[1].payload.reasons, publisher.events[0].payload.reasons);
});

test('a new revision creates a new case and calls the AI again', async () => {
  const { uc, ai, caseOf } = setup();
  await uc.execute(tour());
  await uc.execute(tour({ revision: REV2 }));
  assert.equal(ai.calls.length, 2);
  assert.equal((await caseOf(REV2)).status, 'done');
});

test('AI temporary failure leaves ai_failed and publishes nothing, even with a G1 finding', async () => {
  const { uc, publisher, caseOf } = setup(() => { throw new AiTemporaryError('AI service answered 503', { status: 503 }); });
  await assert.doesNotReject(uc.execute(tour({ places: [near(), close({ lat: 0, lng: 0 })] })));
  assert.equal(publisher.events.length, 0);
  const c = await caseOf();
  assert.equal(c.status, 'ai_failed');
  assert.match(c.lastError, /503/);
});

test('AI 401 config error leaves ai_failed and publishes nothing', async () => {
  const { uc, publisher, caseOf } = setup(() => { throw new AiTemporaryError('401', { status: 401, kind: 'config' }); });
  await uc.execute(tour());
  assert.equal(publisher.events.length, 0);
  assert.equal((await caseOf()).status, 'ai_failed');
});

test('AI 422 publishes a Warning for human review merged with geo findings', async () => {
  const { uc, publisher, caseOf } = setup(() => { throw new AiPermanentError('422', { status: 422, kind: 'invalid_input' }); });
  await uc.execute(tour({ places: [near(), far()] }));
  const { eventName, payload } = publisher.events[0];
  assert.equal(eventName, 'tour.ai_passed');
  assert.equal(payload.warning, true);
  assert.equal(payload.severity, 0.5);
  assert.deepEqual(payload.reasons.map((r) => r.source), ['ai', 'geo']);
  assert.match(payload.reasons[0].message, /human review/);
  const c = await caseOf();
  assert.equal(c.status, 'failed_permanent');
  assert.match(c.lastError, /invalid_input/);
});

test('AI 422 with a G1 finding still publishes tour.ai_rejected', async () => {
  const { uc, publisher } = setup(() => { throw new AiPermanentError('422', { status: 422, kind: 'invalid_input' }); });
  await uc.execute(tour({ places: [near({ lat: 999 }), close()] }));
  assert.equal(publisher.events[0].eventName, 'tour.ai_rejected');
});

test('incomplete payload (no title, language or places) publishes a human-review Warning without the AI', async () => {
  for (const missing of ['title', 'language', 'places']) {
    const { uc, ai, publisher, caseOf } = setup();
    const t = tour();
    delete t[missing];
    await uc.execute(t);
    assert.equal(ai.calls.length, 0, missing);
    const { eventName, payload } = publisher.events[0];
    assert.equal(eventName, 'tour.ai_passed');
    assert.equal(payload.warning, true);
    assert.deepEqual(payload.reasons, [{ ...TOUR_INCOMPLETE_REASON }]);
    assert.equal((await caseOf()).status, 'done');
  }
});

test('payload without revision is logged and skipped: no case, no event', async () => {
  const { uc, ai, publisher, repo, logger } = setup();
  const t = tour();
  delete t.revision;
  await assert.doesNotReject(uc.execute(t));
  assert.equal(ai.calls.length, 0);
  assert.equal(publisher.events.length, 0);
  assert.equal(repo.rows.size, 0);
  assert.ok(logger.lines.some(([level, m]) => level === 'warn' && /no revision/.test(m)));
});

test('more than 50 merged reasons are capped at 50 in the event', async () => {
  const reasons = Array.from({ length: 49 }, (_, i) => aiReason({ message: `r${i}` }));
  const { uc, publisher } = setup(() => aiResult({ verdict: 'Warning', severity: 0.5, reasons }));
  // 3 duplicate stops at the same spot (2 geo findings) + the long leg: 52 reasons in total.
  const places = [near(), near({ placeId: 'pA2', sequence: 1 }), near({ placeId: 'pA3', sequence: 2 }), far({ sequence: 3 })];
  await uc.execute(tour({ places }));
  assert.equal(publisher.events[0].payload.reasons.length, 50);
});

test('indoor tour skips the distance rules', async () => {
  const { uc, publisher } = setup();
  await uc.execute(tour({ type: 'indoor', places: [near(), far()] }));
  const { eventName, payload } = publisher.events[0];
  assert.equal(eventName, 'tour.ai_passed');
  assert.equal(payload.warning, false);
  assert.deepEqual(payload.reasons, []);
});

test('geo limits come from the constructor (config.geo)', async () => {
  const clock = new FakeClock();
  const publisher = new FakePublisher();
  const uc = new RunTourReview({
    repo: new InMemoryModerationRepository({ clock }), aiReviewer: new FakeAiReviewer(() => aiResult()), publisher, clock,
    logger: new FakeLogger(),
    geoLimits: {
      legMaxM: { walking: 500, cycling: 15000, driving: 100000 },
      spreadMaxM: { walking: 10000, cycling: 40000, driving: 200000 },
      speedKmh: { walking: 4.5, cycling: 15, driving: 40 },
      dwellMinutesPerStop: 5, duplicateMinM: 10, durationFactor: 2, zigzagFactor: 1.8, longLegStrongMultiplier: 5,
    },
  });
  await uc.execute(tour()); // 1.1 km leg: fine by default, too long with a 500 m limit
  assert.equal(publisher.events[0].payload.warning, true);
});

test('publish failure keeps the case without publishedAt; a duplicate re-publishes it', async () => {
  const { uc, ai, publisher, caseOf } = setup();
  publisher.failNext = 1;
  await uc.execute(tour());
  assert.equal((await caseOf()).publishedAt, null);
  await uc.execute(tour());
  assert.equal(ai.calls.length, 1);
  assert.equal(publisher.events.length, 1);
  assert.ok((await caseOf()).publishedAt instanceof Date);
});

test('helpers: isTourComplete and withPlaceIds (index after sorting by sequence)', () => {
  assert.equal(isTourComplete(tour()), true);
  assert.equal(isTourComplete(tour({ places: [] })), true);
  assert.equal(isTourComplete(tour({ title: '  ' })), false);
  const places = [far({ sequence: 5 }), near({ sequence: 1 })];
  const out = withPlaceIds([
    { field: 'places[0]', message: 'a' }, { field: 'places[1]', message: 'b' }, { field: 'route', message: 'c' },
    { field: 'places[9]', message: 'd' },
  ], places);
  assert.deepEqual(out.map((r) => r.message), ['a (placeId pA)', 'b (placeId pB)', 'c', 'd']);
});
