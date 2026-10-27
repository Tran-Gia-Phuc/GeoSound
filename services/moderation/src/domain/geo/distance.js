// Geo distance helpers for tour geo rules (task #AI-35). Pure.
// haversineMeters is copied from services/tour/src/domain/geo/distance.js (no cross-service import).

const R = 6371000; // Earth radius (m)
const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in meters between two { lat, lng } points.
export function haversineMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Sum of the legs between consecutive points, in meters. 0 for fewer than 2 points.
export function routeLengthMeters(points = []) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

// Arithmetic mean of lat/lng (good enough at city or region scale). null for no points.
export function centroid(points = []) {
  if (points.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}
