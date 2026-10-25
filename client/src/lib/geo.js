// =========================================================
// Toán học địa lý thuần (UC04). Không phụ thuộc framework.
// Tọa độ polygon theo quy ước GeoJSON [lng, lat] — khớp activation-zone.js
// và point-in-polygon.js của backend (UC11/UC10-E2).
// =========================================================

const R = 6371008.8; // bán kính Trái Đất trung bình (m)
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Khoảng cách Haversine giữa hai điểm {lat,lng}, đơn vị mét. */
export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Góc phương vị (độ, 0=Bắc) từ a đến b. */
export function bearing(a, b) {
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Điểm {lat,lng} có nằm trong vùng tròn (tâm {lat,lng}, bán kính m) không. */
export function pointInCircle(point, center, radiusMeters) {
  return haversine(point, center) <= radiusMeters;
}

/**
 * Ray-casting điểm-trong-đa-giác trên tọa độ GeoJSON [lng, lat].
 * Dùng vành ngoài (ring[0]); không xét lỗ (hole) — vùng kích hoạt UC11 là
 * đa giác đơn. Khớp thuật toán backend để kết quả nhất quán.
 */
export function pointInPolygon(point, geometry) {
  const ring = geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const px = point.lng;
  const py = point.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Chia nhỏ đường route thành các điểm cách nhau ~stepMeters (cho giả lập GPS
 * "đi theo route" chuyển động mượt). Nội suy tuyến tính lat/lng — đủ dùng ở
 * phạm vi đô thị.
 */
export function densifyPath(path, stepMeters = 15) {
  if (!Array.isArray(path) || path.length < 2) return path ? [...path] : [];
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const d = haversine(a, b);
    const n = Math.max(1, Math.ceil(d / stepMeters));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Tâm xấp xỉ của một danh sách {lat,lng} (để canh bản đồ). */
export function centroid(points) {
  if (!points.length) return null;
  const s = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), {
    lat: 0,
    lng: 0,
  });
  return { lat: s.lat / points.length, lng: s.lng / points.length };
}
