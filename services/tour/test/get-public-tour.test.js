// =========================================================
// Unit test UC02 (chi tiết) — GetPublicTour với fake repo (không cần DB).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GetPublicTour } from '../src/application/use-cases/get-public-tour.js';

function fakeTourRepo(tours) {
  return { async findPublicById(id) { return tours.find((t) => t.id === id && t.status === 'public') ?? null; } };
}
function fakePlaceRepo(byTour) {
  return { async listByTour(tourId) { return byTour[tourId] ?? []; } };
}
function fakeRouteConfigRepo(byTour) {
  return { async findByTour(tourId) { return byTour[tourId] ?? null; } };
}

const publicTour = {
  id: 't1', title: 'Phố cổ Hội An', description: 'đi dạo bộ', coverImageUrl: null,
  city: 'Hội An', type: 'walking', originalLanguage: 'vi', status: 'public',
  duration: 120, averageRating: 4.5, ratingCount: 10,
};
const ttsTour = { ...publicTour, id: 't2', originalLanguage: 'en' };
const draftTour = { ...publicTour, id: 't3', status: 'draft' };

const places = {
  t1: [
    { id: 'p1', tourId: 't1', name: 'Chùa Cầu', type: 'historical', lat: 15.8, lng: 108.3, sequence: 0, images: [], audioSource: 'human' },
    { id: 'p2', tourId: 't1', name: 'Nhà cổ', type: 'historical', lat: 15.81, lng: 108.3, sequence: 1, images: [], audioSource: 'tts' },
  ],
  t2: [{ id: 'pa', tourId: 't2', name: 'A', type: 'other', lat: 1, lng: 1, sequence: 0, images: [], audioSource: 'tts' }],
};
const routes = {
  t1: { tourId: 't1', path: [{ lat: 15.8, lng: 108.3 }, { lat: 15.81, lng: 108.3 }], triggers: [{ placeId: 'p1' }], navAudios: [] },
};

function uc(tours = [publicTour, ttsTour, draftTour]) {
  return new GetPublicTour({
    tourRepo: fakeTourRepo(tours),
    placeRepo: fakePlaceRepo(places),
    routeConfigRepo: fakeRouteConfigRepo(routes),
  });
}

test('chi tiết tour công khai: số điểm, nhãn giọng người thật, route, reviews rỗng', async () => {
  const d = await uc().execute({ id: 't1' });
  assert.equal(d.id, 't1');
  assert.equal(d.placeCount, 2);
  assert.equal(d.voiceLabel, 'human'); // có điểm audio người thật
  assert.deepEqual(d.availableLanguages, ['vi']);
  assert.equal(d.selectedLanguage, 'vi');
  assert.equal(d.places.length, 2);
  assert.equal(d.route.path.length, 2);
  assert.deepEqual(d.reviews, []);
  assert.equal(d.averageRating, 4.5);
});

test('E3 — tour nháp/không tồn tại → 404', async () => {
  await assert.rejects(() => uc().execute({ id: 't3' }), (e) => e.status === 404);
  await assert.rejects(() => uc().execute({ id: 'ghost' }), (e) => e.status === 404);
});

test('tour chỉ có TTS → nhãn giọng máy', async () => {
  const d = await uc().execute({ id: 't2' });
  assert.equal(d.voiceLabel, 'tts');
});

test('A2 — chọn ngôn ngữ không khả dụng → về ngôn ngữ gốc', async () => {
  const d = await uc().execute({ id: 't1', lang: 'fr' });
  assert.equal(d.selectedLanguage, 'vi');
  assert.equal(d.voiceLabel, 'human');
});

test('tour chưa cấu hình route → tự sinh route theo điểm + vùng tròn 50 m', async () => {
  const d = await uc().execute({ id: 't2' });
  assert.deepEqual(d.route.path, [{ lat: 1, lng: 1 }]);
  assert.equal(d.route.isDefault, true);
  assert.deepEqual(d.route.navAudios, []);
  assert.deepEqual(d.route.triggers, [
    { placeId: 'pa', zone: { shape: 'circle', center: { lat: 1, lng: 1 }, radiusMeters: 50 }, priority: 0, nextHint: null },
  ]);
});
