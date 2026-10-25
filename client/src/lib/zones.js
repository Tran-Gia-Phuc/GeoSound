// =========================================================
// Giải quyết vùng kích hoạt (UC04 bước 6-11, A1, A2).
// Nhận cấu hình route (UC11) + vị trí hiện tại → cho biết đang ở trong
// vùng nào, và điểm nào thắng theo ĐỘ ƯU TIÊN tác giả đặt.
// zone: { shape:'circle', center, radiusMeters } | { shape:'polygon', geometry }
// =========================================================
import { pointInCircle, pointInPolygon } from './geo.js';

/** Điểm có nằm trong một ActivationZone (UC11) không. */
export function pointInZone(point, zone) {
  if (!zone) return false;
  if (zone.shape === 'circle') {
    return !!zone.center && pointInCircle(point, zone.center, zone.radiusMeters);
  }
  if (zone.shape === 'polygon') {
    return pointInPolygon(point, zone.geometry);
  }
  return false;
}

/**
 * Danh sách trigger (điểm) mà vị trí đang nằm trong vùng, SẮP XẾP theo độ ưu
 * tiên giảm dần (A1: chồng vùng → chọn ưu tiên cao nhất). priority lớn = ưu tiên cao.
 * @returns {Array<{placeId, zone, priority, nextHint}>}
 */
export function triggersAt(point, triggers = []) {
  return triggers
    .filter((t) => pointInZone(point, t.zone))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/** Audio chỉ đường (ngã rẽ) có vùng chứa vị trí hiện tại. */
export function navAudiosAt(point, navAudios = []) {
  return navAudios.filter((n) => pointInZone(point, n.zone));
}
