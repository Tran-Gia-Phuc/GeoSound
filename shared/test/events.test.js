// Contract tests for shared/events: new moderation events and backward compatibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, schemas, validateEvent, reasonSchema } from '../events/index.js';

const AT = '2026-01-01T00:00:00Z';
const OFFSET = '2026-01-01T00:00:00+07:00';

const ok = (event, payload) => assert.equal(schemas[event].safeParse(payload).success, true, `${event} should pass`);
const bad = (event, payload) => assert.equal(schemas[event].safeParse(payload).success, false, `${event} should fail`);

const reason = (over = {}) => ({ field: 'description', category: 'misleading', message: 'Looks misleading.', source: 'ai', severity: 0.5, ...over });

const place = (over = {}) => ({
  placeId: 'p1', tourId: 't1', contributorId: 'u1', revision: AT,
  name: 'Ben Thanh Market', type: 'market', description: 'A historic market.', language: 'vi',
  lat: 10.77, lng: 106.69, city: 'HCMC',
  images: [{ url: 'https://example.com/a.jpg', caption: 'front' }], at: AT, ...over,
});

const tourPlace = (i = 0) => ({ placeId: `p${i}`, name: `Place ${i}`, type: 'cafe', description: 'Nice.', lat: 10, lng: 106, sequence: i });

const tour = (over = {}) => ({
  tourId: 't1', contributorId: 'u1', at: AT, revision: AT, title: 'Old town walk', description: '',
  language: 'en', city: 'Hanoi', type: 'walking', durationMinutes: 90, places: [tourPlace(0), tourPlace(1)], ...over,
});

test('event names: new place.* added, old names unchanged', () => {
  assert.equal(EVENTS.PLACE_SUBMITTED, 'place.submitted');
  assert.equal(EVENTS.PLACE_AI_PASSED, 'place.ai_passed');
  assert.equal(EVENTS.PLACE_AI_REJECTED, 'place.ai_rejected');
  assert.equal(EVENTS.TOUR_SUBMITTED, 'tour.submitted');
  assert.equal(EVENTS.TOUR_AI_PASSED, 'tour.ai_passed');
  assert.equal(EVENTS.TOUR_AI_REJECTED, 'tour.ai_rejected');
  assert.equal(EVENTS.TTS_RENDER_REQUESTED, 'tts.render.requested');
});

test('old minimal tour.* payloads still validate', () => {
  ok(EVENTS.TOUR_SUBMITTED, { tourId: 't1', contributorId: 'u1' });
  ok(EVENTS.TOUR_SUBMITTED, { tourId: 't1', contributorId: 'u1', at: AT });
  ok(EVENTS.TOUR_AI_PASSED, { tourId: 't1' });
  ok(EVENTS.TOUR_AI_REJECTED, { tourId: 't1', reason: 'bad' });
  ok(EVENTS.TOUR_AI_REJECTED, { tourId: 't1', reason: '', contributorEmail: 'a@b.co', tourTitle: 'T', contributorId: 'u1' });
  ok(EVENTS.TOUR_APPROVED, { tourId: 't1', adminId: 'a1' });
  ok(EVENTS.TOUR_REJECTED, { tourId: 't1', reason: 'x' });
  ok(EVENTS.TOUR_REPORTED, { tourId: 't1', count: 3 });
  ok(EVENTS.TOUR_HIDDEN, { tourId: 't1', reason: 'x' });
  ok(EVENTS.TTS_RENDER_REQUESTED, { tourId: 't1', languages: ['vi'] });
  ok(EVENTS.TTS_RENDER_COMPLETED, { tourId: 't1', assets: [{ lang: 'vi', url: 'https://x.io/a.mp3' }] });
});

test('full new payloads validate for all 6 moderation events', () => {
  ok(EVENTS.PLACE_SUBMITTED, place());
  ok(EVENTS.PLACE_AI_PASSED, { placeId: 'p1', tourId: 't1', revision: AT, warning: true, severity: 0.5, reasons: [reason()], at: AT });
  ok(EVENTS.PLACE_AI_REJECTED, { placeId: 'p1', tourId: 't1', revision: AT, reason: 'Hate speech.', reasons: [reason({ category: 'hate' })], at: AT });
  ok(EVENTS.TOUR_SUBMITTED, tour());
  ok(EVENTS.TOUR_AI_PASSED, { tourId: 't1', revision: AT, warning: false, severity: 0.1, reasons: [], contributorId: 'u1', at: AT });
  ok(EVENTS.TOUR_AI_REJECTED, { tourId: 't1', reason: 'Too far apart.', revision: AT, reasons: [reason({ field: 'route', category: 'route', source: 'geo' })] });
});

test('validateEvent returns parsed payload and throws on bad input', () => {
  assert.equal(validateEvent(EVENTS.PLACE_SUBMITTED, place()).placeId, 'p1');
  assert.throws(() => validateEvent(EVENTS.PLACE_SUBMITTED, place({ lat: 91 })));
  assert.throws(() => validateEvent('place.unknown', {}), /Unknown event/);
});

test('timestamps without Z fail', () => {
  bad(EVENTS.PLACE_SUBMITTED, place({ revision: OFFSET }));
  bad(EVENTS.PLACE_SUBMITTED, place({ at: OFFSET }));
  bad(EVENTS.PLACE_AI_PASSED, { placeId: 'p1', tourId: 't1', revision: OFFSET });
  bad(EVENTS.TOUR_SUBMITTED, tour({ revision: OFFSET }));
  bad(EVENTS.TOUR_SUBMITTED, { tourId: 't1', contributorId: 'u1', at: OFFSET });
});

test('limits are enforced', () => {
  bad(EVENTS.TOUR_SUBMITTED, tour({ places: Array.from({ length: 51 }, (_, i) => tourPlace(i)) }));
  ok(EVENTS.TOUR_SUBMITTED, tour({ places: Array.from({ length: 50 }, (_, i) => tourPlace(i)) }));
  bad(EVENTS.PLACE_SUBMITTED, place({ images: Array.from({ length: 6 }, () => ({ url: 'https://x.io/a.jpg' })) }));
  bad(EVENTS.PLACE_AI_REJECTED, { placeId: 'p1', tourId: 't1', revision: AT, reason: 'x'.repeat(1001) });
  ok(EVENTS.PLACE_AI_REJECTED, { placeId: 'p1', tourId: 't1', revision: AT, reason: 'x'.repeat(1000) });
  bad(EVENTS.PLACE_SUBMITTED, place({ lat: 91 }));
  bad(EVENTS.PLACE_SUBMITTED, place({ lng: -181 }));
  bad(EVENTS.PLACE_SUBMITTED, place({ name: 'x'.repeat(201) }));
  bad(EVENTS.PLACE_SUBMITTED, place({ description: 'x'.repeat(2001) }));
  bad(EVENTS.TOUR_SUBMITTED, tour({ description: 'x'.repeat(5001) }));
  bad(EVENTS.TOUR_SUBMITTED, tour({ type: 'flying' }));
  bad(EVENTS.TOUR_SUBMITTED, tour({ durationMinutes: 1.5 }));
  bad(EVENTS.PLACE_AI_PASSED, { placeId: 'p1', tourId: 't1', revision: AT, severity: 1.1 });
  bad(EVENTS.PLACE_AI_PASSED, { placeId: 'p1', tourId: 't1', revision: AT, reasons: Array.from({ length: 51 }, () => reason()) });
});

test('reason categories: unknown fails, route accepted', () => {
  assert.equal(reasonSchema.safeParse(reason({ category: 'spam' })).success, false);
  assert.equal(reasonSchema.safeParse(reason({ category: 'route', source: 'geo' })).success, true);
  assert.equal(reasonSchema.safeParse(reason({ source: 'human' })).success, false);
  bad(EVENTS.PLACE_AI_PASSED, { placeId: 'p1', tourId: 't1', revision: AT, reasons: [reason({ category: 'spam' })] });
});

test('place.submitted requires its core keys', () => {
  for (const key of ['placeId', 'tourId', 'contributorId', 'revision', 'name', 'description', 'language', 'lat', 'lng']) {
    const p = place();
    delete p[key];
    bad(EVENTS.PLACE_SUBMITTED, p);
  }
});

test('other events keep their behaviour', () => {
  bad(EVENTS.TOUR_APPROVED, { tourId: 't1' });
  bad(EVENTS.TTS_RENDER_REQUESTED, { tourId: 't1', languages: [] });
  bad(EVENTS.TOUR_AI_REJECTED, { tourId: 't1' });
  bad(EVENTS.TOUR_SUBMITTED, { tourId: 't1' });
});

// --- Chatbot index events (tour.published / tour.unpublished) ---

const publishedPlace = (i = 0, over = {}) => ({
  placeId: `p${i}`, name: `Place ${i}`, type: 'market', description: 'A market.', lat: 10.77, lng: 106.69, sequence: i,
  translations: [{ language: 'en', text: 'A market.' }], ...over,
});

const published = (over = {}) => ({
  tourId: 't1', revision: AT, status: 'public', title: 'Old town walk', description: 'Street food and history.',
  language: 'vi', city: 'HCMC', type: 'walking', durationMinutes: 90, languages: ['vi', 'en'],
  places: [publishedPlace(0), publishedPlace(1)], at: AT, ...over,
});

test('chatbot event names', () => {
  assert.equal(EVENTS.TOUR_PUBLISHED, 'tour.published');
  assert.equal(EVENTS.TOUR_UNPUBLISHED, 'tour.unpublished');
  assert.equal(EVENTS.TOUR_HIDDEN, 'tour.hidden');
});

test('tour.published: full and minimal payloads validate', () => {
  ok(EVENTS.TOUR_PUBLISHED, published());
  ok(EVENTS.TOUR_PUBLISHED, {
    tourId: 't1', revision: AT, status: 'public', title: 'T', description: '', language: 'en', type: 'indoor',
    places: [publishedPlace(0, { type: undefined, translations: undefined })],
  });
  ok(EVENTS.TOUR_PUBLISHED, published({ places: [] }));
});

test('tour.published: status, revision, limits and required keys are enforced', () => {
  bad(EVENTS.TOUR_PUBLISHED, published({ status: 'draft' }));
  bad(EVENTS.TOUR_PUBLISHED, published({ revision: OFFSET }));
  bad(EVENTS.TOUR_PUBLISHED, published({ at: OFFSET }));
  bad(EVENTS.TOUR_PUBLISHED, published({ type: 'flying' }));
  bad(EVENTS.TOUR_PUBLISHED, published({ title: 'x'.repeat(201) }));
  bad(EVENTS.TOUR_PUBLISHED, published({ description: 'x'.repeat(5001) }));
  bad(EVENTS.TOUR_PUBLISHED, published({ places: Array.from({ length: 51 }, (_, i) => publishedPlace(i)) }));
  ok(EVENTS.TOUR_PUBLISHED, published({ places: Array.from({ length: 50 }, (_, i) => publishedPlace(i)) }));
  bad(EVENTS.TOUR_PUBLISHED, published({ places: [publishedPlace(0, { lat: 91 })] }));
  bad(EVENTS.TOUR_PUBLISHED, published({ places: [publishedPlace(0, { description: 'x'.repeat(2001) })] }));
  bad(EVENTS.TOUR_PUBLISHED, published({ places: [publishedPlace(0, { translations: [{ language: 'en' }] })] }));
  for (const key of ['tourId', 'revision', 'status', 'title', 'description', 'language', 'type', 'places']) {
    const p = published();
    delete p[key];
    bad(EVENTS.TOUR_PUBLISHED, p);
  }
});

test('tour.unpublished: reason enum, optional revision', () => {
  for (const reason of ['unpublished', 'edited', 'hidden', 'restricted', 'deleted']) {
    ok(EVENTS.TOUR_UNPUBLISHED, { tourId: 't1', reason });
  }
  ok(EVENTS.TOUR_UNPUBLISHED, { tourId: 't1', revision: AT, reason: 'hidden', at: AT });
  bad(EVENTS.TOUR_UNPUBLISHED, { tourId: 't1', reason: 'other' });
  bad(EVENTS.TOUR_UNPUBLISHED, { tourId: 't1' });
  bad(EVENTS.TOUR_UNPUBLISHED, { tourId: 't1', reason: 'hidden', revision: OFFSET });
  bad(EVENTS.TOUR_UNPUBLISHED, { reason: 'hidden' });
});

test('tour.changes_requested (UC19): reason 1..1000, recipient optional', () => {
  ok(EVENTS.TOUR_CHANGES_REQUESTED, { tourId: 't1', reason: 'Thêm ảnh cho điểm 2' });
  ok(EVENTS.TOUR_CHANGES_REQUESTED, {
    tourId: 't1', reason: 'x'.repeat(1000), contributorId: 'u1', tourTitle: 'T', at: AT,
  });
  bad(EVENTS.TOUR_CHANGES_REQUESTED, { tourId: 't1', reason: '' });
  bad(EVENTS.TOUR_CHANGES_REQUESTED, { tourId: 't1', reason: 'x'.repeat(1001) });
  bad(EVENTS.TOUR_CHANGES_REQUESTED, { tourId: 't1' });
  bad(EVENTS.TOUR_CHANGES_REQUESTED, { tourId: 't1', reason: 'x', at: OFFSET });
});

test('auth.new_device_login (UC23): userId, email, deviceName, at required; location optional', () => {
  const ev = EVENTS.AUTH_NEW_DEVICE_LOGIN;
  assert.equal(ev, 'auth.new_device_login');
  const full = { userId: 'u1', email: 'an@mail.com', deviceName: 'Chrome trên Windows', location: 'Hà Nội, Việt Nam', at: AT };
  ok(ev, full);
  ok(ev, { ...full, location: undefined });
  bad(ev, { ...full, at: OFFSET });
  bad(ev, { ...full, at: undefined });
  bad(ev, { ...full, email: 'not-an-email' });
  bad(ev, { ...full, deviceName: '' });
  bad(ev, { ...full, userId: undefined });
});
