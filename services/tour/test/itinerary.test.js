// =========================================================
// Unit test UC07 (lịch trình cá nhân) — use-cases với fake repo, không cần DB.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Itinerary } from '../src/domain/entities/itinerary.js';
import { ItineraryItem } from '../src/domain/entities/itinerary-item.js';
import { Place } from '../src/domain/entities/place.js';
import { Tour } from '../src/domain/entities/tour.js';

import { CreateItinerary } from '../src/application/use-cases/create-itinerary.js';
import { GetItinerary } from '../src/application/use-cases/get-itinerary.js';
import { RenameItinerary } from '../src/application/use-cases/rename-itinerary.js';
import { AddItineraryItem } from '../src/application/use-cases/add-itinerary-item.js';
import { RemoveItineraryItem } from '../src/application/use-cases/remove-itinerary-item.js';
import { ReorderItineraryItems } from '../src/application/use-cases/reorder-itinerary-items.js';
import { ShareItinerary } from '../src/application/use-cases/share-itinerary.js';
import { GetSharedItinerary } from '../src/application/use-cases/get-shared-itinerary.js';
import { ExplorePlaces } from '../src/application/use-cases/explore-places.js';
import { snapshotPlace } from '../src/application/use-cases/snapshot-place.js';

const OWNER = 'u-owner';
const OTHER = 'u-other';

// ---- fake ItineraryRepository (giữ trong RAM, mô phỏng gán id + đồng bộ items) ----
function fakeItineraryRepo() {
  const store = new Map();
  let n = 0;
  const gid = (p) => `${p}-${++n}`;
  const clone = (rec) => JSON.parse(JSON.stringify(rec));
  const toEntity = (rec) =>
    new Itinerary({
      ...clone(rec),
      items: clone(rec).items.map((i) => new ItineraryItem(i)),
    });
  const itemsFrom = (it, id) =>
    it.items.map((x, idx) => ({ ...x.toPublic(), id: x.id ?? gid('item'), itineraryId: id, sequence: idx }));
  return {
    _store: store,
    async create(it) {
      const id = gid('itin');
      const rec = {
        id,
        ownerId: it.ownerId,
        name: it.name,
        shareToken: it.shareToken ?? null,
        items: itemsFrom(it, id),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(id, rec);
      return toEntity(rec);
    },
    async findById(id) {
      const rec = store.get(id);
      return rec ? toEntity(rec) : null;
    },
    async findByShareToken(token) {
      for (const rec of store.values()) if (rec.shareToken === token) return toEntity(rec);
      return null;
    },
    async listByOwner(ownerId) {
      return [...store.values()].filter((r) => r.ownerId === ownerId).map(toEntity);
    },
    async save(it) {
      const rec = store.get(it.id);
      rec.name = it.name;
      rec.shareToken = it.shareToken;
      rec.items = itemsFrom(it, it.id);
      rec.updatedAt = new Date().toISOString();
      return toEntity(rec);
    },
    async delete(id) {
      store.delete(id);
    },
  };
}

const publicTour = new Tour({ id: 't-pub', title: 'Phố cổ', originalLanguage: 'vi', status: 'public', authorId: 'author', city: 'Hội An' });
const draftTour = new Tour({ id: 't-draft', title: 'Nháp', originalLanguage: 'vi', status: 'draft', authorId: 'author' });

const places = {
  'p-human': new Place({ id: 'p-human', tourId: 't-pub', name: 'Chùa Cầu', type: 'historical', description: 'mô tả', lat: 15.877, lng: 108.327, audioSource: 'human', audioUrl: 'https://a/p1.mp3', images: [{ url: 'https://i/p1.jpg' }] }),
  'p-tts': new Place({ id: 'p-tts', tourId: 't-pub', name: 'Nhà cổ', type: 'historical', description: 'mô tả 2', lat: 15.879, lng: 108.329, audioSource: 'tts' }),
  'p-draft': new Place({ id: 'p-draft', tourId: 't-draft', name: 'Điểm nháp', description: 'x', lat: 1, lng: 1 }),
};
function fakePlaceRepo() {
  return {
    async findById(id) { return places[id] ?? null; },
    async countPublicPlaces() { return 2; },
    async searchPublicPlaces() {
      return [
        { id: 'p-human', tourId: 't-pub', name: 'Chùa Cầu', type: 'historical', lat: 15.877, lng: 108.327, images: [], audioSource: 'human', tourTitle: 'Phố cổ', city: 'Hội An' },
        { id: 'p-tts', tourId: 't-pub', name: 'Nhà cổ', type: 'historical', lat: 15.879, lng: 108.329, images: [], audioSource: 'tts', tourTitle: 'Phố cổ', city: 'Hội An' },
      ];
    },
  };
}
const tourRepo = { async findById(id) { return id === 't-pub' ? publicTour : id === 't-draft' ? draftTour : null; } };
const langRepo = { async listByTour() { return [{ languageCode: 'vi' }, { languageCode: 'en' }]; } };
const txRepo = { async listByTour() { return [{ placeId: 'p-human', languageCode: 'en', text: 'Bridge Pagoda', ttsUrl: 'tts://en/p1' }]; } };

function deps() {
  const itineraryRepo = fakeItineraryRepo();
  return {
    itineraryRepo,
    create: new CreateItinerary({ itineraryRepo }),
    get: new GetItinerary({ itineraryRepo }),
    rename: new RenameItinerary({ itineraryRepo }),
    add: new AddItineraryItem({ itineraryRepo, placeRepo: fakePlaceRepo(), tourRepo, tourLanguageRepo: langRepo, placeTranslationRepo: txRepo }),
    remove: new RemoveItineraryItem({ itineraryRepo }),
    reorder: new ReorderItineraryItems({ itineraryRepo }),
    share: new ShareItinerary({ itineraryRepo, generateToken: () => 'tok-123' }),
    getShared: new GetSharedItinerary({ itineraryRepo }),
  };
}

test('tạo lịch trình — trả tóm tắt; E2 thiếu tên → 400', async () => {
  const d = deps();
  const it = await d.create.execute({ ownerId: OWNER, name: '  Hội An 1 ngày  ' });
  assert.equal(it.name, 'Hội An 1 ngày');
  assert.equal(it.placeCount, 0);
  await assert.rejects(() => d.create.execute({ ownerId: OWNER, name: '   ' }), (e) => e.status === 400 && e.code === 'validation_error');
});

test('thêm điểm từ tour công khai — snapshot + build view (vùng tròn + khoảng cách/thời gian)', async () => {
  const d = deps();
  const { id } = await d.create.execute({ ownerId: OWNER, name: 'Test' });
  await d.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'p-human' });
  const view = await d.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'p-tts' });
  assert.equal(view.placeCount, 2);
  assert.equal(view.route.triggers.length, 2);
  assert.equal(view.route.triggers[0].zone.shape, 'circle');
  assert.equal(view.route.triggers[0].zone.radiusMeters, 50);
  assert.equal(view.route.path.length, 2);
  assert.ok(view.distanceMeters > 0);
  assert.ok(view.walkingMinutes >= 0);
  // id của place trong view = id item (khớp trigger.placeId)
  assert.equal(view.places[0].id, view.route.triggers[0].placeId);
});

test('BR — chỉ thêm điểm thuộc tour CÔNG KHAI; điểm/thiếu → 404', async () => {
  const d = deps();
  const { id } = await d.create.execute({ ownerId: OWNER, name: 'Test' });
  await assert.rejects(() => d.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'p-draft' }), (e) => e.status === 404 && e.code === 'place_not_addable');
  await assert.rejects(() => d.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'ghost' }), (e) => e.status === 404);
});

test('chủ sở hữu — thao tác lịch trình người khác → 403; không có → 404', async () => {
  const d = deps();
  const { id } = await d.create.execute({ ownerId: OWNER, name: 'Test' });
  await assert.rejects(() => d.get.execute({ ownerId: OTHER, itineraryId: id }), (e) => e.status === 403);
  await assert.rejects(() => d.get.execute({ ownerId: OWNER, itineraryId: 'ghost' }), (e) => e.status === 404);
});

test('đổi tên — E2 thiếu tên → 400', async () => {
  const d = deps();
  const { id } = await d.create.execute({ ownerId: OWNER, name: 'A' });
  const r = await d.rename.execute({ ownerId: OWNER, itineraryId: id, name: 'B' });
  assert.equal(r.name, 'B');
  await assert.rejects(() => d.rename.execute({ ownerId: OWNER, itineraryId: id, name: '' }), (e) => e.status === 400);
});

test('sắp xếp lại — hợp lệ đổi thứ tự; danh sách không khớp → 400', async () => {
  const d = deps();
  const { id } = await d.create.execute({ ownerId: OWNER, name: 'T' });
  await d.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'p-human' });
  let view = await d.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'p-tts' });
  const ids = view.places.map((p) => p.id);
  view = await d.reorder.execute({ ownerId: OWNER, itineraryId: id, orderedIds: [ids[1], ids[0]] });
  assert.deepEqual(view.places.map((p) => p.id), [ids[1], ids[0]]);
  assert.equal(view.places[0].sequence, 0);
  await assert.rejects(() => d.reorder.execute({ ownerId: OWNER, itineraryId: id, orderedIds: [ids[0]] }), (e) => e.status === 400);
});

test('xoá điểm — dồn thứ tự; điểm không có → 404', async () => {
  const d = deps();
  const { id } = await d.create.execute({ ownerId: OWNER, name: 'T' });
  await d.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'p-human' });
  const view = await d.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'p-tts' });
  const ids = view.places.map((p) => p.id);
  const after = await d.remove.execute({ ownerId: OWNER, itineraryId: id, itemId: ids[0] });
  assert.equal(after.placeCount, 1);
  assert.equal(after.places[0].sequence, 0);
  await assert.rejects(() => d.remove.execute({ ownerId: OWNER, itineraryId: id, itemId: 'ghost' }), (e) => e.status === 404);
});

test('A4 chia sẻ — sinh mã, dùng lại; thu hồi; xem theo mã (công khai); mã sai → 404', async () => {
  const d = deps();
  const { id } = await d.create.execute({ ownerId: OWNER, name: 'T' });
  await d.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'p-human' });
  const s1 = await d.share.execute({ ownerId: OWNER, itineraryId: id });
  assert.equal(s1.shareToken, 'tok-123');
  const s2 = await d.share.execute({ ownerId: OWNER, itineraryId: id });
  assert.equal(s2.shareToken, 'tok-123'); // dùng lại

  const shared = await d.getShared.execute({ token: 'tok-123' });
  assert.equal(shared.shared, true);
  assert.equal(shared.placeCount, 1);

  const off = await d.share.execute({ ownerId: OWNER, itineraryId: id, enabled: false });
  assert.equal(off.shareToken, null);
  await assert.rejects(() => d.getShared.execute({ token: 'tok-123' }), (e) => e.status === 404);
});

test('snapshotPlace — audio người thật ở ngôn ngữ gốc; TTS cho ngôn ngữ khác', () => {
  const item = snapshotPlace({
    place: places['p-human'],
    sourceLanguage: 'vi',
    langs: [{ languageCode: 'vi' }, { languageCode: 'en' }],
    translations: [{ placeId: 'p-human', languageCode: 'en', text: 'Bridge', ttsUrl: 'tts://en' }],
  });
  assert.deepEqual(item.availableLanguages, ['vi', 'en']);
  assert.equal(item.audioByLang.vi.audioSource, 'human');
  assert.equal(item.audioByLang.vi.audioUrl, 'https://a/p1.mp3');
  assert.equal(item.audioByLang.en.audioSource, 'tts');
  assert.equal(item.audioByLang.en.text, 'Bridge');
  assert.equal(item.localized('en').audioUrl, 'tts://en');
  assert.equal(item.localized('fr').language, 'vi'); // fallback về gốc
});

test('khám phá địa điểm — lọc + sắp theo khoảng cách khi có toạ độ', async () => {
  const uc = new ExplorePlaces({ placeRepo: fakePlaceRepo() });
  const res = await uc.execute({ q: 'cổ', lat: 15.879, lng: 108.329 });
  assert.equal(res.total, 2);
  assert.equal(res.items.length, 2);
  // gần (15.879,108.329) nhất là p-tts
  assert.equal(res.items[0].placeId, 'p-tts');
  assert.ok('distanceMeters' in res.items[0]);
});
