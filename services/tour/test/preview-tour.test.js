// =========================================================
// Unit test UC13 (xem thử tour) — PreviewTour với fake repo (không cần DB).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PreviewTour } from '../src/application/use-cases/preview-tour.js';
import { Tour } from '../src/domain/entities/tour.js';

function fakeTourRepo(tours) {
  return { async findById(id) { return tours.find((t) => t.id === id) ?? null; } };
}
function fakePlaceRepo(byTour) {
  return { async listByTour(tourId) { return byTour[tourId] ?? []; } };
}
function fakeRouteConfigRepo(byTour) {
  return { async findByTour(tourId) { return byTour[tourId] ?? null; } };
}

const OWNER = 'u1';
// Tour nháp (chưa công khai) — UC13 vẫn phải xem thử được.
const draft = new Tour({
  id: 't1', title: 'Phố cổ', originalLanguage: 'vi', status: 'draft', authorId: OWNER,
  city: 'Hội An', duration: 90,
});
// Tour của người khác.
const otherTour = new Tour({ id: 't2', title: 'X', originalLanguage: 'vi', status: 'draft', authorId: 'u2' });
// Tour của owner nhưng chưa có điểm.
const emptyTour = new Tour({ id: 't3', title: 'Trống', originalLanguage: 'vi', status: 'draft', authorId: OWNER });
// Tour của owner có điểm nhưng chưa vẽ route.
const noRouteTour = new Tour({ id: 't4', title: 'Thiếu route', originalLanguage: 'vi', status: 'draft', authorId: OWNER });

const places = {
  t1: [
    { id: 'p1', tourId: 't1', name: 'Chùa Cầu', type: 'historical', lat: 15.8, lng: 108.3, sequence: 0, images: [], audioSource: 'human', audioUrl: 'https://a/p1.mp3', description: 'mô tả 1' },
    { id: 'p2', tourId: 't1', name: 'Nhà cổ', type: 'historical', lat: 15.81, lng: 108.3, sequence: 1, images: [], audioSource: 'tts', description: 'mô tả 2' },
  ],
  t4: [{ id: 'pa', tourId: 't4', name: 'A', type: 'other', lat: 1, lng: 1, sequence: 0, images: [], audioSource: 'tts', description: 'x' }],
};
const routes = {
  t1: { tourId: 't1', path: [{ lat: 15.8, lng: 108.3 }, { lat: 15.81, lng: 108.3 }], triggers: [{ placeId: 'p1' }], navAudios: [] },
  // t4: chưa có route (không có khóa) → path rỗng.
};

function uc() {
  return new PreviewTour({
    tourRepo: fakeTourRepo([draft, otherTour, emptyTour, noRouteTour]),
    placeRepo: fakePlaceRepo(places),
    routeConfigRepo: fakeRouteConfigRepo(routes),
  });
}

test('xem thử tour nháp của chính mình: trả view chi tiết + cờ preview + status', async () => {
  const d = await uc().execute({ authorId: OWNER, tourId: 't1' });
  assert.equal(d.id, 't1');
  assert.equal(d.preview, true);
  assert.equal(d.status, 'draft'); // tour chưa công khai vẫn xem thử được
  assert.equal(d.placeCount, 2);
  assert.equal(d.voiceLabel, 'human');
  assert.equal(d.route.path.length, 2);
  assert.deepEqual(d.availableLanguages, ['vi']);
  assert.deepEqual(d.reviews, []);
});

test('chặn xem thử tour của người khác → 403', async () => {
  await assert.rejects(() => uc().execute({ authorId: OWNER, tourId: 't2' }), (e) => e.status === 403);
});

test('tour không tồn tại → 404', async () => {
  await assert.rejects(() => uc().execute({ authorId: OWNER, tourId: 'ghost' }), (e) => e.status === 404);
});

test('E1 — chưa có điểm → 422, báo thiếu places', async () => {
  await assert.rejects(
    () => uc().execute({ authorId: OWNER, tourId: 't3' }),
    (e) => e.status === 422 && e.code === 'tour_not_previewable' && e.missing.places === true,
  );
});

test('E1 — có điểm nhưng chưa vẽ route → 422, báo thiếu route', async () => {
  await assert.rejects(
    () => uc().execute({ authorId: OWNER, tourId: 't4' }),
    (e) => e.status === 422 && e.missing.route === true && e.missing.places === false,
  );
});

test('A2 — chọn ngôn ngữ không khả dụng → về ngôn ngữ gốc', async () => {
  const d = await uc().execute({ authorId: OWNER, tourId: 't1', lang: 'fr' });
  assert.equal(d.selectedLanguage, 'vi');
});
