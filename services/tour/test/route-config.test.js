// =========================================================
// Unit test UC11 — use-case route & vùng kích hoạt với fake repo (không cần DB).
//   node --test  (hoặc: npm test)
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { ActivationZone } from '../src/domain/value-objects/activation-zone.js';
import { GetRouteConfig } from '../src/application/use-cases/get-route-config.js';
import { SaveRouteConfig } from '../src/application/use-cases/save-route-config.js';

// --- fakes ---
function fakeTourRepo(seed = []) {
  const rows = new Map(seed.map((t) => [t.id, t]));
  return { async findById(id) { return rows.get(id) ?? null; } };
}

// placeRepo chỉ cần listByTour cho UC11.
function fakePlaceRepo(places = []) {
  return { async listByTour(tourId) { return places.filter((p) => p.tourId === tourId); } };
}

function fakeRouteConfigRepo() {
  const rows = new Map();
  return {
    rows,
    async findByTour(tourId) { return rows.get(tourId) ?? null; },
    async upsert(config) {
      config.updatedAt = new Date();
      rows.set(config.tourId, config);
      return config;
    },
  };
}

function ownedTour(id = 'tour1', authorId = 'u1') {
  return new Tour({ id, title: 'T', originalLanguage: 'vi', status: TOUR_STATUS.DRAFT, authorId });
}

const places = [
  { id: 'p1', tourId: 'tour1' },
  { id: 'p2', tourId: 'tour1' },
];

// Đa giác hợp lệ (khép kín, 4 đỉnh phân biệt + điểm đóng vòng).
const squarePolygon = {
  type: 'Polygon',
  coordinates: [[[108.3, 15.8], [108.4, 15.8], [108.4, 15.9], [108.3, 15.9], [108.3, 15.8]]],
};

function deps() {
  return {
    tourRepo: fakeTourRepo([ownedTour()]),
    placeRepo: fakePlaceRepo(places),
    routeConfigRepo: fakeRouteConfigRepo(),
  };
}

// ---------- ActivationZone (E1) ----------

test('ActivationZone: tròn hợp lệ; bán kính 0 → E1', () => {
  const z = new ActivationZone({ shape: 'circle', center: { lat: 15.8, lng: 108.3 }, radiusMeters: 50 });
  assert.equal(z.shape, 'circle');
  assert.equal(z.radiusMeters, 50);
  assert.throws(
    () => new ActivationZone({ shape: 'circle', center: { lat: 15.8, lng: 108.3 }, radiusMeters: 0 }),
    /Bán kính/
  );
});

test('ActivationZone: đa giác hợp lệ; chưa khép kín → E1', () => {
  const z = new ActivationZone({ shape: 'polygon', geometry: squarePolygon });
  assert.equal(z.shape, 'polygon');
  // Thiếu điểm đóng vòng → không khép kín.
  const open = { type: 'Polygon', coordinates: [[[108.3, 15.8], [108.4, 15.8], [108.4, 15.9]]] };
  assert.throws(() => new ActivationZone({ shape: 'polygon', geometry: open }), /khép kín/);
});

test('ActivationZone: loại không hợp lệ → lỗi', () => {
  assert.throws(() => new ActivationZone({ shape: 'triangle' }), /Loại vùng kích hoạt/);
});

// ---------- SaveRouteConfig ----------

test('SaveRouteConfig: lưu route + vùng tròn/đa giác + ưu tiên + gợi ý', async () => {
  const d = deps();
  const uc = new SaveRouteConfig(d);
  const config = await uc.execute({
    authorId: 'u1',
    tourId: 'tour1',
    path: [{ lat: 15.8, lng: 108.3 }, { lat: 15.9, lng: 108.3 }],
    triggers: [
      {
        placeId: 'p1',
        zone: { shape: 'circle', center: { lat: 15.8, lng: 108.3 }, radiusMeters: 30 },
        priority: 2,
        nextHint: { text: 'Đi tiếp 100m tới Nhà cổ' },
      },
      { placeId: 'p2', zone: { shape: 'polygon', geometry: squarePolygon }, priority: 1 },
    ],
    navAudios: [
      {
        label: 'Rẽ trái ở ngã tư',
        audioUrl: 'https://cdn.example.com/turn.mp3',
        zone: { shape: 'circle', center: { lat: 15.85, lng: 108.3 }, radiusMeters: 20 },
      },
    ],
  });

  assert.equal(config.path.length, 2);
  assert.equal(config.triggers.length, 2);
  assert.equal(config.triggers[0].priority, 2);
  assert.equal(config.triggers[0].zone.shape, 'circle');
  assert.equal(config.triggers[0].nextHint.text, 'Đi tiếp 100m tới Nhà cổ');
  assert.equal(config.triggers[1].zone.shape, 'polygon');
  assert.equal(config.navAudios.length, 1);
  assert.ok(config.navAudios[0].id, 'nav audio được gán id');
});

test('SaveRouteConfig: trigger trỏ điểm không thuộc tour → ValidationError', async () => {
  const uc = new SaveRouteConfig(deps());
  await assert.rejects(
    () => uc.execute({
      authorId: 'u1', tourId: 'tour1',
      triggers: [{ placeId: 'ghost', zone: { shape: 'circle', center: { lat: 15.8, lng: 108.3 }, radiusMeters: 10 } }],
    }),
    /không thuộc tour/
  );
});

test('SaveRouteConfig: hai vùng cho cùng một điểm → ValidationError', async () => {
  const uc = new SaveRouteConfig(deps());
  const z = { shape: 'circle', center: { lat: 15.8, lng: 108.3 }, radiusMeters: 10 };
  await assert.rejects(
    () => uc.execute({
      authorId: 'u1', tourId: 'tour1',
      triggers: [{ placeId: 'p1', zone: z }, { placeId: 'p1', zone: z }],
    }),
    /một vùng kích hoạt/
  );
});

test('SaveRouteConfig: bán kính 0 → E1 chặn lưu', async () => {
  const uc = new SaveRouteConfig(deps());
  await assert.rejects(
    () => uc.execute({
      authorId: 'u1', tourId: 'tour1',
      triggers: [{ placeId: 'p1', zone: { shape: 'circle', center: { lat: 15.8, lng: 108.3 }, radiusMeters: 0 } }],
    }),
    /Bán kính/
  );
});

test('SaveRouteConfig: không phải tác giả → 403; tour không tồn tại → 404', async () => {
  const uc = new SaveRouteConfig(deps());
  await assert.rejects(() => uc.execute({ authorId: 'uX', tourId: 'tour1' }), (e) => e.status === 403);
  await assert.rejects(() => uc.execute({ authorId: 'u1', tourId: 'ghost' }), (e) => e.status === 404);
});

// ---------- GetRouteConfig ----------

test('GetRouteConfig: chưa lưu → cấu hình rỗng; đã lưu → trả lại', async () => {
  const d = deps();
  const get = new GetRouteConfig(d);
  const empty = await get.execute({ authorId: 'u1', tourId: 'tour1' });
  assert.deepEqual(empty.path, []);
  assert.deepEqual(empty.triggers, []);
  assert.deepEqual(empty.navAudios, []);

  const save = new SaveRouteConfig(d);
  await save.execute({
    authorId: 'u1', tourId: 'tour1',
    triggers: [{ placeId: 'p1', zone: { shape: 'circle', center: { lat: 15.8, lng: 108.3 }, radiusMeters: 25 }, priority: 5 }],
  });
  const loaded = await get.execute({ authorId: 'u1', tourId: 'tour1' });
  assert.equal(loaded.triggers.length, 1);
  assert.equal(loaded.triggers[0].priority, 5);
});

test('GetRouteConfig: không phải tác giả → 403', async () => {
  const get = new GetRouteConfig(deps());
  await assert.rejects(() => get.execute({ authorId: 'uX', tourId: 'tour1' }), (e) => e.status === 403);
});

test('SaveRouteConfig: audio chỉ đường không có file → lưu lời nhắc để giọng máy đọc', async () => {
  const uc = new SaveRouteConfig(deps());
  const config = await uc.execute({
    authorId: 'u1', tourId: 'tour1',
    navAudios: [
      { label: 'Ngã tư Trần Phú', text: '  Rẽ phải về phía chợ  ', zone: { shape: 'circle', center: { lat: 15.85, lng: 108.3 }, radiusMeters: 20 } },
    ],
  });
  assert.equal(config.navAudios[0].audioUrl, null);
  assert.equal(config.navAudios[0].text, 'Rẽ phải về phía chợ');
});

test('saveRouteConfigSchema: audio chỉ đường chỉ cần nhãn + vùng (audioUrl tuỳ chọn)', async () => {
  const { saveRouteConfigSchema } = await import('../src/application/dtos/route-config-schemas.js');
  const ok = saveRouteConfigSchema.safeParse({
    navAudios: [{ label: 'Rẽ trái', zone: { shape: 'circle', center: { lat: 1, lng: 1 }, radiusMeters: 10 } }],
  });
  assert.equal(ok.success, true);
  const bad = saveRouteConfigSchema.safeParse({
    navAudios: [{ label: 'Rẽ trái', audioUrl: 'not-a-url', zone: { shape: 'circle', center: { lat: 1, lng: 1 }, radiusMeters: 10 } }],
  });
  assert.equal(bad.success, false);
});
