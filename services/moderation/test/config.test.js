// Moderation config: GEO_* env parsing (task #AI-35).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { DEFAULT_GEO_LIMITS } from '../src/domain/geo/tour-geo-rules.js';

test('geo defaults equal DEFAULT_GEO_LIMITS when no env is set', () => {
  assert.deepEqual(loadConfig({}).geo, DEFAULT_GEO_LIMITS);
});

test('geo defaults match .env.example values', () => {
  const env = {
    GEO_LEG_MAX_M_WALKING: '3000', GEO_LEG_MAX_M_CYCLING: '15000', GEO_LEG_MAX_M_DRIVING: '100000',
    GEO_SPREAD_MAX_M_WALKING: '10000', GEO_SPREAD_MAX_M_CYCLING: '40000', GEO_SPREAD_MAX_M_DRIVING: '200000',
    GEO_DUPLICATE_MIN_M: '10', GEO_DURATION_FACTOR: '2', GEO_ZIGZAG_FACTOR: '1.8',
  };
  assert.deepEqual(loadConfig(env).geo, DEFAULT_GEO_LIMITS);
});

test('GEO_* env values override the defaults, floats included', () => {
  const geo = loadConfig({
    GEO_LEG_MAX_M_WALKING: '2500', GEO_LEG_MAX_M_CYCLING: '12000.5', GEO_LEG_MAX_M_DRIVING: '80000',
    GEO_SPREAD_MAX_M_WALKING: '8000', GEO_SPREAD_MAX_M_CYCLING: '30000', GEO_SPREAD_MAX_M_DRIVING: '150000',
    GEO_DUPLICATE_MIN_M: '15', GEO_DURATION_FACTOR: '2.5', GEO_ZIGZAG_FACTOR: '1.5',
  }).geo;
  assert.deepEqual(geo.legMaxM, { walking: 2500, cycling: 12000.5, driving: 80000 });
  assert.deepEqual(geo.spreadMaxM, { walking: 8000, cycling: 30000, driving: 150000 });
  assert.equal(geo.duplicateMinM, 15);
  assert.equal(geo.durationFactor, 2.5);
  assert.equal(geo.zigzagFactor, 1.5);
  assert.deepEqual(geo.speedKmh, DEFAULT_GEO_LIMITS.speedKmh);
  assert.equal(geo.dwellMinutesPerStop, DEFAULT_GEO_LIMITS.dwellMinutesPerStop);
  assert.equal(geo.longLegStrongMultiplier, DEFAULT_GEO_LIMITS.longLegStrongMultiplier);
});

for (const bad of ['', 'abc', '0', '-5']) {
  test(`invalid GEO value ${JSON.stringify(bad)} falls back to the default`, () => {
    const geo = loadConfig({ GEO_ZIGZAG_FACTOR: bad, GEO_LEG_MAX_M_WALKING: bad }).geo;
    assert.equal(geo.zigzagFactor, DEFAULT_GEO_LIMITS.zigzagFactor);
    assert.equal(geo.legMaxM.walking, DEFAULT_GEO_LIMITS.legMaxM.walking);
  });
}

test('geo config has the same keys as DEFAULT_GEO_LIMITS', () => {
  assert.deepEqual(Object.keys(loadConfig({}).geo).sort(), Object.keys(DEFAULT_GEO_LIMITS).sort());
});
