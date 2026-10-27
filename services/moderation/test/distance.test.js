// Geo distance helpers (task #AI-35).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineMeters, routeLengthMeters, centroid } from '../src/domain/geo/distance.js';

const BEN_THANH = { lat: 10.7721, lng: 106.6983 };
const NOTRE_DAME_SAIGON = { lat: 10.7798, lng: 106.699 };
const PARIS = { lat: 48.8566, lng: 2.3522 };
const LONDON = { lat: 51.5074, lng: -0.1278 };

test('haversine: same point is 0', () => {
  assert.equal(haversineMeters(BEN_THANH, BEN_THANH), 0);
});

test('haversine: one degree of latitude is about 111.2 km', () => {
  const d = haversineMeters({ lat: 10, lng: 106 }, { lat: 11, lng: 106 });
  assert.ok(Math.abs(d - 111195) < 1, `got ${d}`);
});

test('haversine: Ben Thanh market to Notre-Dame Saigon is under 1 km straight line', () => {
  const d = haversineMeters(BEN_THANH, NOTRE_DAME_SAIGON);
  assert.ok(d > 800 && d < 950, `got ${d}`);
});

test('haversine: Paris to London is about 343.5 km and symmetric', () => {
  const d = haversineMeters(PARIS, LONDON);
  assert.ok(Math.abs(d - 343500) < 1000, `got ${d}`);
  assert.equal(d, haversineMeters(LONDON, PARIS));
});

test('routeLengthMeters sums consecutive legs; fewer than 2 points is 0', () => {
  assert.equal(routeLengthMeters([]), 0);
  assert.equal(routeLengthMeters([BEN_THANH]), 0);
  const back = routeLengthMeters([BEN_THANH, NOTRE_DAME_SAIGON, BEN_THANH]);
  assert.ok(Math.abs(back - 2 * haversineMeters(BEN_THANH, NOTRE_DAME_SAIGON)) < 1e-6);
});

test('centroid is the mean of lat/lng; null for no points', () => {
  assert.equal(centroid([]), null);
  assert.deepEqual(centroid([{ lat: 10, lng: 100 }]), { lat: 10, lng: 100 });
  assert.deepEqual(centroid([{ lat: 10, lng: 100 }, { lat: 12, lng: 104 }, { lat: 14, lng: 102 }]), { lat: 12, lng: 102 });
});
