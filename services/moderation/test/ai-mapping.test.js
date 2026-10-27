// Event <-> AI wire mapping and truncation (task #AI-34, decision D9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlaceRequest, toTourRequest, fromAiResponse, truncate, AI_LIMITS } from '../src/application/dtos/ai-mapping.js';
import { AiTemporaryError } from '../src/domain/errors/index.js';

const cp = (s) => Array.from(s).length; // length as the AI (Python) counts it
const long = (n, ch = 'a') => ch.repeat(n);
const SMILE = String.fromCodePoint(0x1f600); // one code point, two UTF-16 units

test('place: camelCase -> snake_case, optional keys dropped', () => {
  const body = toPlaceRequest({
    placeId: 'p1', tourId: 't1', contributorId: 'u1', revision: '2026-01-01T00:00:00.000Z',
    name: 'Ben Thanh', description: 'Market', language: 'en', lat: 10.7, lng: 106.6,
  });
  assert.deepEqual(body, { place_id: 'p1', tour_id: 't1', name: 'Ben Thanh', description: 'Market', language: 'en' });
});

test('place: optional keys mapped, images limited to 5, missing caption dropped', () => {
  const images = Array.from({ length: 8 }, (_, i) => ({ url: `https://h/${i}.jpg`, ...(i === 0 && { caption: 'Gate' }) }));
  const body = toPlaceRequest({
    placeId: 'p1', tourId: 't1', name: 'N', type: 'market', description: 'D', language: 'vi', city: 'HCM', images,
  });
  assert.equal(body.type, 'market');
  assert.equal(body.city, 'HCM');
  assert.equal(body.images.length, AI_LIMITS.images);
  assert.deepEqual(body.images[0], { url: 'https://h/0.jpg', caption: 'Gate' });
  assert.deepEqual(body.images[1], { url: 'https://h/1.jpg' });
});

test('place: long text is truncated to the limits', () => {
  const body = toPlaceRequest({
    placeId: 'p1', tourId: 't1', name: long(500), description: long(9000), language: 'en',
    images: [{ url: 'https://h/a.jpg', caption: long(1000) }],
  });
  assert.equal(cp(body.name), 200);
  assert.equal(cp(body.description), 2000);
  assert.equal(cp(body.images[0].caption), 300);
});

test('tour: 60 places and long strings never exceed the limits', () => {
  const places = Array.from({ length: 60 }, (_, i) => ({
    placeId: `p${i}`, name: long(400), type: i % 2 ? 'cafe' : undefined, description: long(3000), lat: 10, lng: 106, sequence: i,
  }));
  const body = toTourRequest({
    tourId: 't1', contributorId: 'u1', title: long(1000), description: long(20000), language: 'vi',
    city: 'Hue', type: 'walking', durationMinutes: 90, places,
  });
  assert.equal(cp(body.title), AI_LIMITS.title);
  assert.equal(cp(body.description), AI_LIMITS.tourDescription);
  assert.equal(body.places.length, AI_LIMITS.places);
  for (const pl of body.places) {
    assert.ok(cp(pl.name) <= AI_LIMITS.placeName);
    assert.ok(cp(pl.description) <= AI_LIMITS.placeDescription);
    for (const k of Object.keys(pl)) assert.ok(['place_id', 'name', 'type', 'description'].includes(k), k);
  }
  assert.deepEqual(body.places[0], { place_id: 'p0', name: long(200), description: long(2000) });
  assert.equal(body.places[1].type, 'cafe');
  assert.equal(body.duration_minutes, 90);
  assert.equal(body.city, 'Hue');
  assert.equal(body.type, 'walking');
  assert.ok(!('durationMinutes' in body) && !('contributorId' in body));
});

test('tour: missing optional keys dropped, places default to []', () => {
  const body = toTourRequest({ tourId: 't1', contributorId: 'u1', title: 'T', description: 'D', language: 'en' });
  assert.deepEqual(body, { tour_id: 't1', title: 'T', description: 'D', language: 'en', places: [] });
});

test('truncate counts code points and never splits a surrogate pair', () => {
  assert.equal(truncate(SMILE.repeat(250), 200), SMILE.repeat(200));
  assert.equal(truncate(SMILE.repeat(150), 200), SMILE.repeat(150)); // 300 units but 150 code points
  assert.equal(truncate('abc', 200), 'abc');
  assert.equal(truncate(undefined, 10), undefined);
});

test('fromAiResponse maps snake_case and tags reasons with source ai', () => {
  const out = fromAiResponse({
    place_id: 'p1', verdict: 'Warning', severity: 0.55,
    reasons: [{ field: 'description', category: 'misleading', message: 'Hours look wrong.' }],
    images_checked: 0, model: 'gemini-2.5-flash',
  });
  assert.deepEqual(out, {
    verdict: 'Warning', severity: 0.55,
    reasons: [{ field: 'description', category: 'misleading', message: 'Hours look wrong.', source: 'ai' }],
    imagesChecked: 0, model: 'gemini-2.5-flash',
  });
});

test('fromAiResponse: no images_checked, unknown category -> other, long message cut', () => {
  const out = fromAiResponse({
    tour_id: 't1', verdict: 'Reject', severity: 0.9, model: 'llama',
    reasons: [{ field: 'coherence', category: 'weird', message: long(900) }],
  });
  assert.equal(out.imagesChecked, 0);
  assert.equal(out.reasons[0].category, 'other');
  assert.equal(cp(out.reasons[0].message), 500);
  assert.deepEqual(fromAiResponse({ verdict: 'Pass', severity: 0, model: 'm' }).reasons, []);
});

test('fromAiResponse: a malformed body is a temporary error (retried)', () => {
  const bad = [
    null, 'text', {}, { verdict: 'Maybe', severity: 0.1, reasons: [] },
    { verdict: 'Pass', severity: 2, reasons: [] }, { verdict: 'Pass', severity: '0.1', reasons: [] },
    { verdict: 'Pass', severity: 0.1, reasons: 'x' }, { verdict: 'Pass', severity: 0.1, reasons: [{ field: 'name' }] },
  ];
  for (const b of bad) {
    assert.throws(() => fromAiResponse(b), (e) => e instanceof AiTemporaryError && e.kind === 'malformed');
  }
});
