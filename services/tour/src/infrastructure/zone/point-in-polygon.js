// =========================================================
// Kiểm điểm nằm trong polygon — thuật toán ray casting, thuần JS, không phụ thuộc.
// Tương đương @turf/boolean-point-in-polygon cho GeoJSON Polygon (có hỗ trợ lỗ).
// Toàn bộ tọa độ theo quy ước GeoJSON: [lng, lat].
// =========================================================

/**
 * Điểm có nằm trong một vòng (ring) không — ray casting.
 * @param {number} x lng @param {number} y lat @param {number[][]} ring mảng [lng, lat]
 */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Điểm có nằm trong GeoJSON Polygon không (ngoài vòng chính & không rơi vào lỗ).
 * @param {[number, number]} point [lng, lat]
 * @param {{ type?: string, coordinates?: number[][][] }} polygon GeoJSON Polygon geometry
 * @returns {boolean}
 */
export function pointInPolygon([x, y], polygon) {
  const rings = polygon?.coordinates;
  if (!Array.isArray(rings) || rings.length === 0) return false;

  // Phải nằm trong vòng ngoài cùng.
  if (!pointInRing(x, y, rings[0])) return false;

  // ...và không nằm trong bất kỳ lỗ nào (các vòng còn lại).
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(x, y, rings[h])) return false;
  }
  return true;
}
