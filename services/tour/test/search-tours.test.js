// =========================================================
// Unit test UC02 (tìm kiếm) — SearchTours với fake repo (không cần DB).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SearchTours } from '../src/application/use-cases/search-tours.js';

// --- dữ liệu mẫu ---
const tours = [
  { id: 't1', title: 'Phố cổ Hội An', description: 'đi dạo bộ', coverImageUrl: null, city: 'Hội An', originalLanguage: 'vi', type: 'walking', status: 'public', averageRating: 4.5, ratingCount: 10, duration: 120, createdAt: new Date('2026-01-01') },
  { id: 't2', title: 'Đà Nẵng food tour', description: 'ẩm thực đường phố', coverImageUrl: null, city: 'Đà Nẵng', originalLanguage: 'vi', type: 'walking', status: 'public', averageRating: 4.9, ratingCount: 2, duration: 90, createdAt: new Date('2026-03-01') },
  { id: 't3', title: 'Nháp Huế', description: 'chưa duyệt', coverImageUrl: null, city: 'Huế', originalLanguage: 'vi', type: 'walking', status: 'draft', averageRating: 0, ratingCount: 0, duration: null, createdAt: new Date('2026-02-01') },
  { id: 't4', title: 'Saigon by night', description: 'night drive', coverImageUrl: null, city: 'Hồ Chí Minh', originalLanguage: 'en', type: 'driving', status: 'public', averageRating: 4.0, ratingCount: 5, duration: 60, createdAt: new Date('2026-02-15') },
];
const places = [
  { id: 'p1', tourId: 't1', sequence: 0, lat: 15.8801, lng: 108.338, audioSource: 'human' },
  { id: 'p2', tourId: 't1', sequence: 1, lat: 15.8805, lng: 108.339, audioSource: 'tts' },
  { id: 'pa', tourId: 't2', sequence: 0, lat: 16.0678, lng: 108.221, audioSource: 'tts' },
  // t4 chưa có điểm nào
];

function publicMatch(t, f) {
  if (t.status !== 'public') return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!(t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))) return false;
  }
  if (f.city && t.city.toLowerCase() !== f.city.toLowerCase()) return false;
  if (f.language && t.originalLanguage !== f.language) return false;
  if (f.type && t.type !== f.type) return false;
  return true;
}
function sortTours(arr, sort) {
  const by = [...arr];
  if (sort === 'rating') by.sort((a, b) => b.averageRating - a.averageRating || b.ratingCount - a.ratingCount);
  else if (sort === 'recent') by.sort((a, b) => b.createdAt - a.createdAt);
  else by.sort((a, b) => b.ratingCount - a.ratingCount || b.averageRating - a.averageRating || b.createdAt - a.createdAt);
  return by;
}

const fakeTourRepo = {
  async countPublic(f) { return tours.filter((t) => publicMatch(t, f)).length; },
  async searchPublicPage(f, { skip, take, sort }) {
    return sortTours(tours.filter((t) => publicMatch(t, f)), sort).slice(skip, skip + take);
  },
  async listPublicIds(f) { return tours.filter((t) => publicMatch(t, f)).map((t) => t.id); },
  async findManyByIds(ids) { return tours.filter((t) => ids.includes(t.id) && t.status === 'public'); },
};
const fakePlaceRepo = {
  async statsByTours(ids) {
    const m = new Map(ids.map((id) => [id, { count: 0, humanCount: 0 }]));
    for (const p of places) {
      if (!m.has(p.tourId)) continue;
      const s = m.get(p.tourId);
      s.count++;
      if (p.audioSource === 'human') s.humanCount++;
    }
    return m;
  },
  async anchorsByTours(ids) {
    const m = new Map();
    for (const p of [...places].sort((a, b) => a.sequence - b.sequence)) {
      if (ids.includes(p.tourId) && !m.has(p.tourId)) m.set(p.tourId, { lat: p.lat, lng: p.lng });
    }
    return m;
  },
};

const uc = new SearchTours({ tourRepo: fakeTourRepo, placeRepo: fakePlaceRepo });
const run = (input = {}) => uc.execute({ sort: 'popular', page: 1, limit: 20, ...input });

test('chỉ trả tour công khai, bỏ tour nháp; sort popular theo ratingCount', async () => {
  const { tours: cards, total } = await run();
  assert.equal(total, 3); // t1,t2,t4 (t3 draft bị loại)
  assert.deepEqual(cards.map((c) => c.id), ['t1', 't4', 't2']);
});

test('từ khóa khớp tên/mô tả', async () => {
  const { tours: cards } = await run({ q: 'food' });
  assert.deepEqual(cards.map((c) => c.id), ['t2']);
});

test('lọc theo thành phố (không phân biệt hoa thường)', async () => {
  const { tours: cards } = await run({ city: 'đà nẵng' });
  assert.deepEqual(cards.map((c) => c.id), ['t2']);
});

test('lọc theo ngôn ngữ & loại tour', async () => {
  assert.deepEqual((await run({ language: 'en' })).tours.map((c) => c.id), ['t4']);
  assert.deepEqual((await run({ type: 'driving' })).tours.map((c) => c.id), ['t4']);
});

test('nhãn giọng ưu tiên người thật; số điểm đúng', async () => {
  const { tours: cards } = await run();
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(byId.t1.voiceLabel, 'human'); // có điểm audio người thật
  assert.equal(byId.t1.placeCount, 2);
  assert.equal(byId.t2.voiceLabel, 'tts'); // chỉ TTS
  assert.equal(byId.t2.placeCount, 1);
  assert.equal(byId.t4.placeCount, 0);
});

test('sort rating theo điểm trung bình', async () => {
  const { tours: cards } = await run({ sort: 'rating' });
  assert.deepEqual(cards.map((c) => c.id), ['t2', 't1', 't4']);
});

test('sort nearby theo khoảng cách điểm đầu; loại tour không có điểm', async () => {
  const { tours: cards, total } = await run({ sort: 'nearby', lat: 15.88, lng: 108.338 });
  assert.equal(total, 2); // t4 không có điểm → không định vị được
  assert.equal(cards[0].id, 't1');
  assert.equal(cards[1].id, 't2');
  assert.ok(cards[0].distanceMeters < cards[1].distanceMeters);
  assert.equal(typeof cards[0].distanceMeters, 'number');
});

test('phân trang: limit + total', async () => {
  const page1 = await run({ limit: 2, page: 1 });
  assert.equal(page1.total, 3);
  assert.equal(page1.tours.length, 2);
  const page2 = await run({ limit: 2, page: 2 });
  assert.equal(page2.tours.length, 1);
});

test('E1 — không có tour khớp → danh sách rỗng', async () => {
  const { tours: cards, total } = await run({ q: 'không-tồn-tại-xyz' });
  assert.equal(total, 0);
  assert.deepEqual(cards, []);
});
