// =========================================================
// Unit test UC10 — use-case điểm dừng với fake repo + zone checker (không cần DB).
//   node --test  (hoặc: npm test)
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { ForbiddenZoneError } from '../src/domain/errors/index.js';
import { AddPlace } from '../src/application/use-cases/add-place.js';
import { ListPlaces } from '../src/application/use-cases/list-places.js';
import { UpdatePlace } from '../src/application/use-cases/update-place.js';
import { DeletePlace } from '../src/application/use-cases/delete-place.js';
import { ReorderPlaces } from '../src/application/use-cases/reorder-places.js';

// --- fakes ---
function fakeTourRepo(seed = []) {
  const rows = new Map(seed.map((t) => [t.id, t]));
  return { async findById(id) { return rows.get(id) ?? null; } };
}

function fakePlaceRepo() {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    async create(place) {
      place.id = `p${++seq}`;
      rows.set(place.id, place);
      return place;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async listByTour(tourId) {
      return [...rows.values()]
        .filter((p) => p.tourId === tourId)
        .sort((a, b) => a.sequence - b.sequence);
    },
    async save(place) { rows.set(place.id, place); return place; },
    async delete(id) { rows.delete(id); },
    async nextSequence(tourId) {
      const seqs = [...rows.values()].filter((p) => p.tourId === tourId).map((p) => p.sequence);
      return seqs.length ? Math.max(...seqs) + 1 : 0;
    },
    async reorder(tourId, orderedIds) {
      orderedIds.forEach((id, i) => { rows.get(id).sequence = i; });
    },
  };
}

const allowAll = { async assertAllowed() {} };
const forbidAll = { async assertAllowed() { throw new ForbiddenZoneError('khu quân sự'); } };

function ownedTour(id = 'tour1', authorId = 'u1') {
  return new Tour({ id, title: 'T', originalLanguage: 'vi', status: TOUR_STATUS.DRAFT, authorId });
}

test('AddPlace: thêm điểm, sequence tăng dần, mặc định audio TTS', async () => {
  const tourRepo = fakeTourRepo([ownedTour()]);
  const placeRepo = fakePlaceRepo();
  const uc = new AddPlace({ tourRepo, placeRepo, zoneChecker: allowAll });

  const p1 = await uc.execute({ authorId: 'u1', tourId: 'tour1', name: '  Chùa Cầu  ', description: '  mô tả  ', lat: 15.8, lng: 108.3 });
  const p2 = await uc.execute({ authorId: 'u1', tourId: 'tour1', name: 'Nhà cổ', description: 'x', lat: 15.9, lng: 108.3 });

  assert.equal(p1.sequence, 0);
  assert.equal(p2.sequence, 1);
  assert.equal(p1.name, 'Chùa Cầu'); // trim
  assert.equal(p1.description, 'mô tả'); // trim
  assert.equal(p1.audioSource, 'tts');
});

test('AddPlace: có audio người thật → audioSource = human', async () => {
  const uc = new AddPlace({ tourRepo: fakeTourRepo([ownedTour()]), placeRepo: fakePlaceRepo(), zoneChecker: allowAll });
  const p = await uc.execute({
    authorId: 'u1', tourId: 'tour1', name: 'A', description: 'x', lat: 15.8, lng: 108.3,
    audioUrl: 'https://cdn.example.com/a.mp3',
  });
  assert.equal(p.audioSource, 'human');
});

test('AddPlace: vị trí trong vùng cấm → 422 (E2)', async () => {
  const uc = new AddPlace({ tourRepo: fakeTourRepo([ownedTour()]), placeRepo: fakePlaceRepo(), zoneChecker: forbidAll });
  await assert.rejects(
    () => uc.execute({ authorId: 'u1', tourId: 'tour1', name: 'A', description: 'x', lat: 21, lng: 105 }),
    (err) => err.status === 422 && err.code === 'forbidden_zone'
  );
});

test('AddPlace: không phải tác giả → 403; tour không tồn tại → 404', async () => {
  const placeRepo = fakePlaceRepo();
  const uc = new AddPlace({ tourRepo: fakeTourRepo([ownedTour()]), placeRepo, zoneChecker: allowAll });
  await assert.rejects(
    () => uc.execute({ authorId: 'uX', tourId: 'tour1', name: 'A', description: 'x', lat: 15, lng: 108 }),
    (err) => err.status === 403
  );
  await assert.rejects(
    () => uc.execute({ authorId: 'u1', tourId: 'ghost', name: 'A', description: 'x', lat: 15, lng: 108 }),
    (err) => err.status === 404
  );
});

test('AddPlace: lat/lng ngoài biên → ValidationError', async () => {
  const uc = new AddPlace({ tourRepo: fakeTourRepo([ownedTour()]), placeRepo: fakePlaceRepo(), zoneChecker: allowAll });
  await assert.rejects(
    () => uc.execute({ authorId: 'u1', tourId: 'tour1', name: 'A', description: 'x', lat: 999, lng: 108 }),
    /Vĩ độ/
  );
});

test('UpdatePlace: điểm không thuộc tour → 404; sửa tên hợp lệ', async () => {
  const tourRepo = fakeTourRepo([ownedTour()]);
  const placeRepo = fakePlaceRepo();
  const add = new AddPlace({ tourRepo, placeRepo, zoneChecker: allowAll });
  const p = await add.execute({ authorId: 'u1', tourId: 'tour1', name: 'Cũ', description: 'x', lat: 15, lng: 108 });

  const update = new UpdatePlace({ tourRepo, placeRepo, zoneChecker: allowAll });
  await assert.rejects(
    () => update.execute({ authorId: 'u1', tourId: 'tour1', placeId: 'nope', patch: { name: 'X' } }),
    (err) => err.status === 404
  );
  const saved = await update.execute({ authorId: 'u1', tourId: 'tour1', placeId: p.id, patch: { name: '  Mới  ' } });
  assert.equal(saved.name, 'Mới');
});

test('ReorderPlaces: đảo thứ tự hợp lệ; tập id sai → ValidationError', async () => {
  const tourRepo = fakeTourRepo([ownedTour()]);
  const placeRepo = fakePlaceRepo();
  const add = new AddPlace({ tourRepo, placeRepo, zoneChecker: allowAll });
  const a = await add.execute({ authorId: 'u1', tourId: 'tour1', name: 'A', description: 'x', lat: 15, lng: 108 });
  const b = await add.execute({ authorId: 'u1', tourId: 'tour1', name: 'B', description: 'x', lat: 15, lng: 108 });

  const reorder = new ReorderPlaces({ tourRepo, placeRepo });
  const result = await reorder.execute({ authorId: 'u1', tourId: 'tour1', orderedIds: [b.id, a.id] });
  assert.deepEqual(result.map((p) => p.name), ['B', 'A']);

  await assert.rejects(
    () => reorder.execute({ authorId: 'u1', tourId: 'tour1', orderedIds: [a.id] }),
    /không khớp/
  );
});

test('DeletePlace: xóa điểm của mình', async () => {
  const tourRepo = fakeTourRepo([ownedTour()]);
  const placeRepo = fakePlaceRepo();
  const add = new AddPlace({ tourRepo, placeRepo, zoneChecker: allowAll });
  const p = await add.execute({ authorId: 'u1', tourId: 'tour1', name: 'A', description: 'x', lat: 15, lng: 108 });

  const del = new DeletePlace({ tourRepo, placeRepo });
  const res = await del.execute({ authorId: 'u1', tourId: 'tour1', placeId: p.id });
  assert.equal(res.id, p.id);
  assert.equal(await placeRepo.findById(p.id), null);
});
