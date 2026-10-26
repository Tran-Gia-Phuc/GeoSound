// =========================================================
// Route & vùng kích hoạt HIỆU LỰC của tour (UC11 → UC04/UC13).
// Quy tắc: tác giả không bắt buộc phải cấu hình route trước khi xem thử hay
// xuất bản. Phần nào chưa cấu hình thì hệ thống tự sinh mặc định:
//   - path      : chưa vẽ → nối các điểm theo thứ tự (sequence)
//   - triggers  : điểm chưa có vùng → vùng tròn DEFAULT_ZONE_RADIUS_METERS
//                 quanh điểm, ưu tiên 0, không có gợi ý đi tiếp
//   - navAudios : chỉ có khi tác giả thêm
// Vùng đã lưu của điểm không còn thuộc tour bị bỏ qua.
// Thuần domain: không biết Prisma/HTTP.
// =========================================================

export const DEFAULT_ZONE_RADIUS_METERS = 50;

const bySequence = (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0);
const hasCoords = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Vùng kích hoạt mặc định cho một điểm (tròn, tâm tại điểm). */
export function defaultTrigger(place) {
  return {
    placeId: place.id,
    zone: {
      shape: 'circle',
      center: { lat: place.lat, lng: place.lng },
      radiusMeters: DEFAULT_ZONE_RADIUS_METERS,
    },
    priority: 0,
    nextHint: null,
  };
}

/**
 * @param {{ places: Array<{id,lat,lng,sequence}>, config?: { path?, triggers?, navAudios? }|null }} input
 *   config = cấu hình đã lưu (null nếu tác giả chưa từng lưu).
 * @returns {{ path, triggers, navAudios, isDefault: boolean }}
 *   isDefault = chưa từng lưu cấu hình (mọi thứ đều tự sinh).
 */
export function effectiveRoute({ places, config }) {
  const ordered = [...places].sort(bySequence);

  const savedPath = config?.path ?? [];
  const path = savedPath.length
    ? savedPath
    : ordered.filter(hasCoords).map((p) => ({ lat: p.lat, lng: p.lng }));

  const savedByPlace = new Map((config?.triggers ?? []).map((t) => [t.placeId, t]));
  const triggers = ordered
    .map((p) => savedByPlace.get(p.id) ?? (hasCoords(p) ? defaultTrigger(p) : null))
    .filter(Boolean);

  return {
    path,
    triggers,
    navAudios: config?.navAudios ?? [],
    isDefault: !config,
  };
}
