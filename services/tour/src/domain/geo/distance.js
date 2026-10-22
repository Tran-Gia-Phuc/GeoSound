// =========================================================
// Khoảng cách đại vòng (haversine) giữa hai tọa độ — mét. Thuần JS, không
// phụ thuộc. Dùng cho sắp xếp "gần tôi" (UC02 / A1) khi chưa bật PostGIS.
// =========================================================

const R = 6371000; // bán kính Trái Đất (m)
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 * @returns {number} khoảng cách mét
 */
export function haversineMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
