// =========================================================
// Ước tính khoảng cách & thời gian di chuyển của lịch trình (UC07 bước 7).
// Thuần JS: cộng dồn haversine giữa các điểm liên tiếp, chia tốc độ đi bộ.
// =========================================================
import { haversineMeters } from './distance.js';

const WALK_SPEED_MPS = 1.25; // ~4.5 km/h — tốc độ đi bộ tham quan

/**
 * @param {Array<{ lat: number, lng: number }>} points theo đúng thứ tự lịch trình
 * @returns {{ distanceMeters: number, walkingMinutes: number, legs: number[] }}
 *   legs = khoảng cách (m) từng chặng giữa 2 điểm liên tiếp
 */
export function itineraryMetrics(points) {
  const legs = [];
  let distanceMeters = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineMeters(points[i - 1], points[i]);
    legs.push(Math.round(d));
    distanceMeters += d;
  }
  distanceMeters = Math.round(distanceMeters);
  const walkingMinutes = Math.round(distanceMeters / WALK_SPEED_MPS / 60);
  return { distanceMeters, walkingMinutes, legs };
}
