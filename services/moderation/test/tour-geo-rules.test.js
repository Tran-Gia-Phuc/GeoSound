// Tour geo rules G1-G6 (task #AI-35): table-driven per rule and per tour type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTourGeo, DEFAULT_GEO_LIMITS } from '../src/domain/geo/tour-geo-rules.js';

// Points along one meridian, so the distance between two of them is exactly the offset in meters.
const BASE = { lat: 10.7769, lng: 106.7009 };
const M_PER_DEG = (6371000 * Math.PI) / 180;
const at = (meters, sequence, extra = {}) => ({
  placeId: `p${sequence}`, name: `Place ${sequence}`, lat: BASE.lat + meters / M_PER_DEG, lng: BASE.lng, sequence, ...extra,
});
const stops = (...offsets) => offsets.map((m, i) => at(m, i + 1));

// Which rule produced a reason, read from its message.
const RULE_PATTERNS = [
  ['G1', /invalid coordinate/], ['G2', /is only/], ['G3', /from the previous stop/],
  ['G4', /tour center/], ['G5', /declared/], ['G6', /zig-zags/],
];
const ruleOf = (r) => RULE_PATTERNS.find(([, re]) => re.test(r.message))?.[0];
const rules = (out) => out.reasons.map(ruleOf);
const only = (out, rule) => out.reasons.filter((r) => ruleOf(r) === rule);

const L = DEFAULT_GEO_LIMITS;
const MOVING = ['walking', 'cycling', 'driving'];
const ALL_TYPES = [...MOVING, 'indoor'];

test('empty or missing places is Pass with severity 0', () => {
  for (const input of [{ type: 'walking', places: [] }, { type: 'walking' }, {}, undefined]) {
    assert.deepEqual(evaluateTourGeo(input), { verdict: 'Pass', severity: 0, reasons: [] });
  }
});

test('a single valid stop is Pass for every type', () => {
  for (const type of ALL_TYPES) {
    assert.equal(evaluateTourGeo({ type, durationMinutes: 1, places: stops(0) }).verdict, 'Pass');
  }
});

// G1
const invalidCoords = [
  ['lat above 90', { lat: 90.1, lng: 106 }],
  ['lat below -90', { lat: -91, lng: 106 }],
  ['lng above 180', { lat: 10, lng: 180.5 }],
  ['lng below -180', { lat: 10, lng: -181 }],
  ['exactly (0, 0)', { lat: 0, lng: 0 }],
  ['NaN lat', { lat: Number.NaN, lng: 106 }],
  ['Infinity lng', { lat: 10, lng: Number.POSITIVE_INFINITY }],
  ['missing lat', { lat: undefined, lng: 106 }],
  ['string lat', { lat: '10.7', lng: 106 }],
];
for (const type of ALL_TYPES) {
  for (const [name, coord] of invalidCoords) {
    test(`G1 ${type}: ${name} rejects with severity 1 on places[i]`, () => {
      const places = [at(0, 1), { ...at(100, 2), ...coord }];
      const out = evaluateTourGeo({ type, places });
      assert.equal(out.verdict, 'Reject');
      assert.equal(out.severity, 1);
      assert.deepEqual(only(out, 'G1').map((r) => [r.field, r.severity]), [['places[1]', 1]]);
    });
  }
}

const validEdgeCoords = [
  ['lat 90 / lng 180', { lat: 90, lng: 180 }],
  ['lat -90 / lng -180', { lat: -90, lng: -180 }],
  ['equator, lng not 0', { lat: 0, lng: 10 }],
  ['prime meridian, lat not 0', { lat: 10, lng: 0 }],
];
for (const [name, coord] of validEdgeCoords) {
  test(`G1: ${name} is a valid coordinate`, () => {
    const out = evaluateTourGeo({ type: 'indoor', places: [{ ...coord, sequence: 1 }] });
    assert.equal(out.verdict, 'Pass');
  });
}

test('G1 rejects even when other rules warn, severity stays 1', () => {
  const places = [...stops(0, 5, 20000), { ...at(0, 4), lat: 0, lng: 0 }];
  const out = evaluateTourGeo({ type: 'walking', durationMinutes: 10, places });
  assert.equal(out.verdict, 'Reject');
  assert.equal(out.severity, 1);
  assert.ok(rules(out).includes('G2') && rules(out).includes('G3'));
});

test('G1: invalid stops are excluded from distance rules', () => {
  // Without exclusion, the (0, 0) stop would make huge legs, spread and duration.
  const places = [at(0, 1), { ...at(0, 2), lat: 0, lng: 0 }, at(1000, 3)];
  const out = evaluateTourGeo({ type: 'walking', durationMinutes: 60, places });
  assert.deepEqual(rules(out), ['G1']);
  assert.equal(out.reasons[0].field, 'places[1]');
});

// G2
for (const type of ALL_TYPES) {
  for (const [gap, triggers] of [[0, true], [5, true], [L.duplicateMinM - 0.5, true], [L.duplicateMinM + 0.5, false], [50, false]]) {
    test(`G2 ${type}: stops ${gap} m apart ${triggers ? 'warn' : 'do not warn'}`, () => {
      const out = evaluateTourGeo({ type, places: stops(0, gap) });
      const found = only(out, 'G2');
      if (triggers) {
        assert.equal(out.verdict, 'Warning');
        assert.deepEqual(found.map((r) => [r.field, r.severity]), [['places[1]', 0.4]]);
      } else {
        assert.equal(found.length, 0);
      }
    });
  }
}

test('G2 checks any pair, not only consecutive stops, and flags the later stop once', () => {
  const out = evaluateTourGeo({ type: 'walking', places: stops(0, 500, 3, 2) });
  assert.deepEqual(only(out, 'G2').map((r) => r.field), ['places[2]', 'places[3]']);
});

// G3
for (const type of MOVING) {
  const max = L.legMaxM[type];
  const strong = max * L.longLegStrongMultiplier;
  for (const [leg, expected] of [[max - 1, null], [max + 1, 0.5], [strong - 1, 0.5], [strong + 1, 0.7]]) {
    test(`G3 ${type}: leg of ${leg} m -> ${expected ?? 'no finding'}`, () => {
      const out = evaluateTourGeo({ type, places: stops(0, leg) });
      const found = only(out, 'G3');
      if (expected === null) {
        assert.equal(found.length, 0);
      } else {
        assert.deepEqual(found.map((r) => [r.field, r.severity]), [['places[1]', expected]]);
        assert.equal(out.verdict, 'Warning');
      }
    });
  }
}

test('G3 message is short, rounded and names the limit and type', () => {
  const out = evaluateTourGeo({ type: 'walking', places: stops(0, 1000, 5200) });
  assert.equal(only(out, 'G3')[0].message, 'Stop 3 is 4.2 km from the previous stop (limit 3 km for walking).');
});

test('#253: a Vietnamese tour gets Vietnamese geo messages', () => {
  const out = evaluateTourGeo({ type: 'walking', language: 'vi', places: stops(0, 1000, 5200) });
  const g3 = out.reasons.find((r) => r.field === 'places[2]');
  assert.equal(g3.message, 'Điểm dừng 3 cách điểm trước 4.2 km (giới hạn 3 km khi đi bộ).');
  const invalid = evaluateTourGeo({ type: 'driving', language: 'vi-VN', places: [at(0, 1), { ...at(10, 2), lat: 999 }] });
  assert.equal(invalid.reasons[0].message, 'Điểm dừng 2 có tọa độ không hợp lệ.');
  const slow = evaluateTourGeo({ type: 'walking', language: 'vi', durationMinutes: 10, places: stops(0, 2000, 4000) });
  assert.ok(slow.reasons.some((r) => /^Lộ trình cần khoảng \d+ phút khi đi bộ, .* 10 phút\.$/.test(r.message)));
});

test('#253: English, unknown and missing languages keep the English text', () => {
  for (const language of ['en', 'fr', undefined, '']) {
    const out = evaluateTourGeo({ type: 'walking', language, places: stops(0, 1000, 5200) });
    assert.equal(only(out, 'G3')[0].message, 'Stop 3 is 4.2 km from the previous stop (limit 3 km for walking).', `language ${language}`);
  }
});

test('unknown or missing type uses walking limits', () => {
  for (const type of [undefined, 'boat', '']) {
    const out = evaluateTourGeo({ type, places: stops(0, L.legMaxM.walking + 1) });
    assert.equal(only(out, 'G3').length, 1, `type ${type}`);
  }
});

// G4: two stops 2 * r apart have their farthest stop r from the centroid.
for (const type of MOVING) {
  const max = L.spreadMaxM[type];
  for (const [radius, triggers] of [[max - 1, false], [max + 1, true]]) {
    test(`G4 ${type}: spread ${radius} m ${triggers ? 'warns' : 'does not warn'}`, () => {
      const out = evaluateTourGeo({ type, places: stops(0, 2 * radius) });
      const found = only(out, 'G4');
      if (triggers) assert.deepEqual(found.map((r) => [r.field, r.severity]), [['route', 0.5]]);
      else assert.equal(found.length, 0);
    });
  }
}

// G5: two stops; estimated = leg / speed + 2 * dwell.
const g5 = [
  // type, leg m, estimated minutes
  ['walking', 1500, 30],
  ['cycling', 10000, 50],
  ['driving', 80000, 130],
];
for (const [type, leg, estimated] of g5) {
  const limitDuration = estimated / L.durationFactor;
  for (const [duration, triggers] of [[limitDuration - 1, true], [limitDuration + 1, false], [0, false], [undefined, false]]) {
    test(`G5 ${type}: ~${estimated} min vs duration ${duration} -> ${triggers ? 'warn' : 'none'}`, () => {
      const out = evaluateTourGeo({ type, durationMinutes: duration, places: stops(0, leg) });
      const found = only(out, 'G5');
      if (triggers) assert.deepEqual(found.map((r) => [r.field, r.severity]), [['route', 0.4]]);
      else assert.equal(found.length, 0);
    });
  }
}

// G6: zig-zag 0, 2000, 500, 2500 (route 5500 m, nearest neighbour 2500 m) vs ordered.
const SCALE = { walking: 1, cycling: 5, driving: 30 };
for (const type of MOVING) {
  const s = SCALE[type];
  const cases = [
    ['zig-zag order', [0, 2000, 500, 2500], true],
    ['ordered stops', [0, 500, 2000, 2500], false],
    ['only 3 stops', [0, 2000, 500], false],
    ['mild detour under 1.8x', [0, 1000, 500, 2500], false],
  ];
  for (const [name, offsets, triggers] of cases) {
    test(`G6 ${type}: ${name} -> ${triggers ? 'warn' : 'none'}`, () => {
      const out = evaluateTourGeo({ type, places: stops(...offsets.map((m) => m * s)) });
      const found = only(out, 'G6');
      if (triggers) assert.deepEqual(found.map((r) => [r.field, r.severity]), [['route', 0.4]]);
      else assert.equal(found.length, 0);
    });
  }
}

test('G6 boundary around the zigzag factor (route 1810 m vs nearest neighbour 1010 m, ratio ~1.79)', () => {
  const places = stops(0, 1000, 600, 1010);
  assert.equal(only(evaluateTourGeo({ type: 'walking', places }), 'G6').length, 0);
  assert.equal(only(evaluateTourGeo({ type: 'walking', places }, { ...L, zigzagFactor: 1.78 }), 'G6').length, 1);
});

// indoor
test('indoor runs only G1 and G2', () => {
  const places = stops(0, 500000, 2000, 900000, 5);
  const out = evaluateTourGeo({ type: 'indoor', durationMinutes: 1, places });
  assert.deepEqual(rules(out), ['G2']);
  const clean = evaluateTourGeo({ type: 'indoor', durationMinutes: 1, places: stops(0, 500000, 2000, 900000) });
  assert.equal(clean.verdict, 'Pass');
});

test('the same far-flung tour warns on G3-G6 for walking', () => {
  const out = evaluateTourGeo({ type: 'walking', durationMinutes: 10, places: stops(0, 20000, 2000, 25000) });
  for (const rule of ['G3', 'G4', 'G5', 'G6']) assert.ok(rules(out).includes(rule), rule);
  assert.equal(out.verdict, 'Warning');
  assert.equal(out.severity, 0.7);
});

// sorting
test('stops are sorted by sequence (stable) before rules; fields use the sorted index', () => {
  const places = [at(5000, 3), at(0, 1), at(1000, 2)];
  const out = evaluateTourGeo({ type: 'walking', places });
  // Sorted: 0, 1000, 5000 -> only the last leg (4 km) is long.
  assert.deepEqual(only(out, 'G3').map((r) => r.field), ['places[2]']);
  const ties = evaluateTourGeo({ type: 'walking', places: [at(0, 1), at(5000, 2, { placeId: 'a' }), at(5000, 2, { placeId: 'b' })] });
  assert.deepEqual(only(ties, 'G2').map((r) => r.field), ['places[2]']);
});

test('input places are not mutated', () => {
  const places = [at(5000, 2), at(0, 1)];
  const copy = structuredClone(places);
  evaluateTourGeo({ type: 'walking', places });
  assert.deepEqual(places, copy);
});

// shape
test('reasons have the shape mergeVerdicts and reasonSchema expect', () => {
  const out = evaluateTourGeo({ type: 'walking', durationMinutes: 5, places: [...stops(0, 3, 20000), { lat: 0, lng: 0, sequence: 9 }] });
  assert.ok(out.reasons.length >= 4);
  for (const r of out.reasons) {
    assert.deepEqual(Object.keys(r).sort(), ['category', 'field', 'message', 'severity', 'source']);
    assert.equal(r.category, 'route');
    assert.equal(r.source, 'geo');
    assert.match(r.field, /^(route|places\[\d+\])$/);
    assert.ok(r.message.length > 0 && r.message.length <= 500);
    assert.ok(r.severity >= 0 && r.severity <= 1);
  }
  assert.equal(out.severity, Math.max(...out.reasons.map((r) => r.severity)));
});

test('custom limits are used instead of the defaults', () => {
  const limits = { ...L, legMaxM: { ...L.legMaxM, walking: 500 } };
  assert.equal(only(evaluateTourGeo({ type: 'walking', places: stops(0, 600) }, limits), 'G3').length, 1);
  assert.equal(only(evaluateTourGeo({ type: 'walking', places: stops(0, 600) }), 'G3').length, 0);
});
