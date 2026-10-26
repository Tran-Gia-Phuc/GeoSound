// =========================================================
// Unit test UC10 / E2 — vùng cấm: hàm point-in-polygon, PolygonZoneChecker,
// và tích hợp với AddPlace (fake repo, không cần DB).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pointInPolygon } from '../src/infrastructure/zone/point-in-polygon.js';
import { PolygonZoneChecker } from '../src/infrastructure/zone/polygon-zone-checker.js';
import { AddPlace } from '../src/application/use-cases/add-place.js';
import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';

// Hình vuông [100..101] x [0..1] (lng x lat).
const square = {
  type: 'Polygon',
  coordinates: [
    [
      [100, 0],
      [101, 0],
      [101, 1],
      [100, 1],
      [100, 0],
    ],
  ],
};

// Hình vuông ngoài [0..10] có lỗ [4..6] (donut).
const donut = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ],
  ],
};

test('pointInPolygon: trong / ngoài hình vuông', () => {
  assert.equal(pointInPolygon([100.5, 0.5], square), true);
  assert.equal(pointInPolygon([102, 0.5], square), false);
  assert.equal(pointInPolygon([100.5, 2], square), false);
});

test('pointInPolygon: điểm trong lỗ → ngoài polygon', () => {
  assert.equal(pointInPolygon([1, 1], donut), true); // trong vành
  assert.equal(pointInPolygon([5, 5], donut), false); // rơi vào lỗ
});

test('pointInPolygon: geometry rỗng → false', () => {
  assert.equal(pointInPolygon([0, 0], {}), false);
  assert.equal(pointInPolygon([0, 0], { type: 'Polygon', coordinates: [] }), false);
});

test('PolygonZoneChecker: điểm trong vùng cấm → ForbiddenZoneError kèm tên', async () => {
  const zoneRepo = {
    async listActive() {
      return [{ id: 'z1', name: 'Khu quân sự', type: 'military', geometry: square }];
    },
  };
  const checker = new PolygonZoneChecker({ zoneRepo });
  await assert.rejects(
    () => checker.assertAllowed({ lat: 0.5, lng: 100.5 }),
    (err) => err.status === 422 && err.code === 'forbidden_zone' && err.zone.name === 'Khu quân sự' && err.zone.geometry?.type === 'Polygon'
  );
});

test('PolygonZoneChecker: ngoài vùng / không có vùng → hợp lệ', async () => {
  const withZone = new PolygonZoneChecker({
    zoneRepo: { async listActive() { return [{ id: 'z1', name: 'X', type: 'military', geometry: square }]; } },
  });
  await withZone.assertAllowed({ lat: 5, lng: 200 }); // không ném

  const empty = new PolygonZoneChecker({ zoneRepo: { async listActive() { return []; } } });
  await empty.assertAllowed({ lat: 0.5, lng: 100.5 }); // không ném
});

test('AddPlace + PolygonZoneChecker: chặn thêm điểm trong vùng cấm (E2 end-to-end)', async () => {
  const tour = new Tour({ id: 'tour1', title: 'T', originalLanguage: 'vi', status: TOUR_STATUS.DRAFT, authorId: 'u1' });
  const tourRepo = { async findById(id) { return id === 'tour1' ? tour : null; } };
  const placeRepo = {
    created: [],
    async nextSequence() { return 0; },
    async create(p) { p.id = 'p1'; this.created.push(p); return p; },
  };
  const zoneChecker = new PolygonZoneChecker({
    zoneRepo: { async listActive() { return [{ id: 'z1', name: 'Trường học', type: 'school', geometry: square }]; } },
  });
  const addPlace = new AddPlace({ tourRepo, placeRepo, zoneChecker });

  await assert.rejects(
    () => addPlace.execute({ authorId: 'u1', tourId: 'tour1', name: 'A', description: 'x', lat: 0.5, lng: 100.5 }),
    (err) => err.code === 'forbidden_zone'
  );
  assert.equal(placeRepo.created.length, 0); // không lưu điểm vi phạm

  // Ngoài vùng cấm (tọa độ hợp lệ, ngoài hình vuông) → thêm được.
  const ok = await addPlace.execute({ authorId: 'u1', tourId: 'tour1', name: 'B', description: 'x', lat: 5, lng: 50 });
  assert.equal(ok.id, 'p1');
});
