// =========================================================
// Unit test route hiệu lực (route + vùng kích hoạt tự sinh khi chưa cấu hình).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { effectiveRoute, DEFAULT_ZONE_RADIUS_METERS } from '../src/domain/route/effective-route.js';

const places = [
  { id: 'p2', lat: 15.81, lng: 108.31, sequence: 1 },
  { id: 'p1', lat: 15.8, lng: 108.3, sequence: 0 },
  { id: 'p3', lat: 15.82, lng: 108.32, sequence: 2 },
];

test('chưa lưu cấu hình → route nối điểm theo sequence, mỗi điểm một vùng tròn mặc định', () => {
  const r = effectiveRoute({ places, config: null });
  assert.equal(r.isDefault, true);
  assert.deepEqual(r.path, [
    { lat: 15.8, lng: 108.3 },
    { lat: 15.81, lng: 108.31 },
    { lat: 15.82, lng: 108.32 },
  ]);
  assert.deepEqual(r.triggers.map((t) => t.placeId), ['p1', 'p2', 'p3']);
  for (const t of r.triggers) {
    assert.equal(t.zone.shape, 'circle');
    assert.equal(t.zone.radiusMeters, DEFAULT_ZONE_RADIUS_METERS);
    assert.equal(t.priority, 0);
  }
  assert.deepEqual(r.navAudios, []);
});

test('đã lưu: giữ path + vùng đã lưu; điểm chưa có vùng được điền mặc định', () => {
  const saved = {
    path: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
    triggers: [{ placeId: 'p2', zone: { shape: 'circle', center: { lat: 15.81, lng: 108.31 }, radiusMeters: 20 }, priority: 7 }],
    navAudios: [{ id: 'n1', label: 'Rẽ trái', audioUrl: 'https://a/n1.mp3', zone: {} }],
  };
  const r = effectiveRoute({ places, config: saved });
  assert.equal(r.isDefault, false);
  assert.deepEqual(r.path, saved.path);
  const p2 = r.triggers.find((t) => t.placeId === 'p2');
  assert.equal(p2.zone.radiusMeters, 20);
  assert.equal(p2.priority, 7);
  assert.equal(r.triggers.find((t) => t.placeId === 'p1').zone.radiusMeters, DEFAULT_ZONE_RADIUS_METERS);
  assert.equal(r.navAudios.length, 1);
});

test('đã lưu nhưng path rỗng → vẫn tự nối các điểm', () => {
  const r = effectiveRoute({ places, config: { path: [], triggers: [], navAudios: [] } });
  assert.equal(r.path.length, 3);
  assert.equal(r.triggers.length, 3);
});

test('vùng đã lưu của điểm không còn thuộc tour bị bỏ qua', () => {
  const r = effectiveRoute({
    places,
    config: { path: [], triggers: [{ placeId: 'gone', zone: {}, priority: 0 }], navAudios: [] },
  });
  assert.ok(!r.triggers.some((t) => t.placeId === 'gone'));
});

test('tour chưa có điểm → route và vùng rỗng', () => {
  const r = effectiveRoute({ places: [], config: null });
  assert.deepEqual(r.path, []);
  assert.deepEqual(r.triggers, []);
});
