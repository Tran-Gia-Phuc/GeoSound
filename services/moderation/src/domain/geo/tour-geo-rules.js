// Tour geo rules G1-G6 (task #AI-35). Pure, deterministic, no LLM.
// See docs/02-design/moderation-architecture.md section 5.1. Only G1 can Reject; any other finding is a
// Warning so a human looks at it. Output shape matches what mergeVerdicts expects.
import { VERDICT } from '../entities/moderation-case.js';
import { haversineMeters, routeLengthMeters, centroid } from './distance.js';

export const DEFAULT_GEO_LIMITS = Object.freeze({
  legMaxM: Object.freeze({ walking: 3000, cycling: 15000, driving: 100000 }),
  spreadMaxM: Object.freeze({ walking: 10000, cycling: 40000, driving: 200000 }),
  speedKmh: Object.freeze({ walking: 4.5, cycling: 15, driving: 40 }),
  dwellMinutesPerStop: 5,
  duplicateMinM: 10,
  durationFactor: 2,
  zigzagFactor: 1.8,
  longLegStrongMultiplier: 5,
});

const MOVING_TYPES = ['walking', 'cycling', 'driving'];

const SEVERITY = Object.freeze({
  invalid: 1,
  duplicate: 0.4,
  longLeg: 0.5,
  longLegStrong: 0.7,
  spread: 0.5,
  duration: 0.4,
  zigzag: 0.4,
});

const fmtDistance = (m) => (m >= 1000 ? `${(Math.round(m / 100) / 10).toString()} km` : `${Math.round(m)} m`);
const fmtMinutes = (min) => `${Math.round(min)} min`;

const finding = (field, severity, message) => ({ field, category: 'route', message, source: 'geo', severity });

export function isValidCoordinate(p) {
  if (p == null) return false;
  const { lat, lng } = p;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

// Stable sort by sequence; a missing sequence goes last, keeping input order. Exported so callers can map
// a `places[i]` field (index after this sort) back to its placeId.
export function sortBySequence(places) {
  const key = (p) => (Number.isFinite(p?.sequence) ? p.sequence : Number.POSITIVE_INFINITY);
  return places
    .map((p, i) => ({ p, i }))
    .sort((a, b) => key(a.p) - key(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

// Greedy nearest-neighbour route starting at the first stop.
function nearestNeighbourLength(points) {
  const rest = points.slice(1);
  let current = points[0];
  let total = 0;
  while (rest.length > 0) {
    let best = 0;
    let bestD = haversineMeters(current, rest[0]);
    for (let k = 1; k < rest.length; k += 1) {
      const d = haversineMeters(current, rest[k]);
      if (d < bestD) {
        best = k;
        bestD = d;
      }
    }
    total += bestD;
    current = rest.splice(best, 1)[0];
  }
  return total;
}

export function evaluateTourGeo({ type, durationMinutes, places } = {}, limits = DEFAULT_GEO_LIMITS) {
  const sorted = sortBySequence(Array.isArray(places) ? places : []);
  const isIndoor = type === 'indoor';
  const mode = MOVING_TYPES.includes(type) ? type : 'walking';
  const reasons = [];

  // G1: invalid coordinates. Those stops are excluded from G2-G6.
  const valid = [];
  let hasInvalid = false;
  sorted.forEach((p, i) => {
    if (isValidCoordinate(p)) {
      valid.push({ index: i, lat: p.lat, lng: p.lng });
    } else {
      hasInvalid = true;
      reasons.push(finding(`places[${i}]`, SEVERITY.invalid, `Stop ${i + 1} has an invalid coordinate.`));
    }
  });

  // G2: duplicate stops (any pair). One finding per later stop.
  for (let b = 1; b < valid.length; b += 1) {
    for (let a = 0; a < b; a += 1) {
      const d = haversineMeters(valid[a], valid[b]);
      if (d < limits.duplicateMinM) {
        reasons.push(finding(
          `places[${valid[b].index}]`,
          SEVERITY.duplicate,
          `Stop ${valid[b].index + 1} is only ${fmtDistance(d)} from stop ${valid[a].index + 1} (minimum ${fmtDistance(limits.duplicateMinM)}).`,
        ));
        break;
      }
    }
  }

  if (!isIndoor && valid.length >= 2) {
    // G3: long leg between consecutive valid stops.
    const legMax = limits.legMaxM[mode];
    for (let k = 1; k < valid.length; k += 1) {
      const d = haversineMeters(valid[k - 1], valid[k]);
      if (d > legMax) {
        const strong = d > legMax * limits.longLegStrongMultiplier;
        reasons.push(finding(
          `places[${valid[k].index}]`,
          strong ? SEVERITY.longLegStrong : SEVERITY.longLeg,
          `Stop ${valid[k].index + 1} is ${fmtDistance(d)} from the previous stop (limit ${fmtDistance(legMax)} for ${mode}).`,
        ));
      }
    }

    // G4: spread around the centroid.
    const c = centroid(valid);
    const spread = Math.max(...valid.map((p) => haversineMeters(c, p)));
    const spreadMax = limits.spreadMaxM[mode];
    if (spread > spreadMax) {
      reasons.push(finding(
        'route',
        SEVERITY.spread,
        `The farthest stop is ${fmtDistance(spread)} from the tour center (limit ${fmtDistance(spreadMax)} for ${mode}).`,
      ));
    }

    // G5: estimated time vs declared duration.
    const routeM = routeLengthMeters(valid);
    if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
      const travelMin = (routeM / 1000 / limits.speedKmh[mode]) * 60;
      const estimated = travelMin + limits.dwellMinutesPerStop * valid.length;
      if (estimated > limits.durationFactor * durationMinutes) {
        reasons.push(finding(
          'route',
          SEVERITY.duration,
          `The route needs about ${fmtMinutes(estimated)} for ${mode}, much more than the declared ${fmtMinutes(durationMinutes)}.`,
        ));
      }
    }

    // G6: zig-zag order compared with a nearest-neighbour route.
    if (valid.length >= 4) {
      const nn = nearestNeighbourLength(valid);
      if (nn > 0 && routeM > limits.zigzagFactor * nn) {
        reasons.push(finding(
          'route',
          SEVERITY.zigzag,
          `The stop order zig-zags: the route is ${fmtDistance(routeM)}, a shorter order would be about ${fmtDistance(nn)}.`,
        ));
      }
    }
  }

  const verdict = hasInvalid ? VERDICT.REJECT : reasons.length > 0 ? VERDICT.WARNING : VERDICT.PASS;
  const severity = reasons.reduce((max, r) => Math.max(max, r.severity), 0);
  return { verdict, severity, reasons };
}
