// =========================================================
// Kiểm tra "sẵn sàng xuất bản" của một tour (UC09 A3 — xuất bản thẳng, D1).
// Bắt buộc: có tên, ngôn ngữ gốc, ít nhất một điểm dừng, mọi điểm có mô tả
// (mô tả là nội dung thuyết minh / nguồn đọc TTS). Route & vùng kích hoạt KHÔNG
// bắt buộc vì đã tự sinh mặc định (effective-route).
// Khuyến nghị (không chặn): ảnh bìa, mô tả tour.
// UC15 (MODERATION_EVENTS_ENABLED, D5): extra required checks 'placesModeration' (no place
// 'checking' or 'rejected') and 'placesLimit' (at most 50 places, the tour.submitted limit).
// Thuần domain — dùng chung cho use-case xuất bản và hiển thị checklist.
// =========================================================

const filled = (s) => typeof s === 'string' && s.trim().length > 0;

/**
 * @param {{ tour: { title, originalLanguage, description?, coverImageUrl? },
 *           places: Array<{ id, name, description?, moderationStatus? }>,
 *           requireModeration?: boolean }} input
 * @returns {{ ready: boolean, checks: Array<{ key: string, ok: boolean, required: boolean, label: string }> }}
 */
export function checkPublishReadiness({ tour, places, requireModeration = false }) {
  const missingDescription = places.filter((p) => !filled(p.description));
  const checks = [
    { key: 'title', ok: filled(tour.title), required: true, label: 'Có tên tour' },
    { key: 'language', ok: filled(tour.originalLanguage), required: true, label: 'Có ngôn ngữ gốc' },
    { key: 'places', ok: places.length > 0, required: true, label: 'Có ít nhất một điểm dừng' },
    {
      // Chưa có điểm thì mục 'places' đã báo — không báo trùng ở đây.
      key: 'placeDescriptions',
      ok: missingDescription.length === 0,
      required: true,
      label: missingDescription.length
        ? `Điểm chưa có mô tả: ${missingDescription.map((p) => p.name).join(', ')}`
        : 'Mọi điểm dừng đều có mô tả',
    },
    ...(requireModeration ? [moderationCheck(places), placesLimitCheck(places)] : []),
    { key: 'cover', ok: filled(tour.coverImageUrl), required: false, label: 'Có ảnh bìa' },
    { key: 'description', ok: filled(tour.description), required: false, label: 'Có mô tả tour' },
  ];
  const ready = checks.every((c) => c.ok || !c.required);
  return { ready, checks };
}

// D5 — 'warning' does not block (the Admin sees the reasons at review).
function moderationCheck(places) {
  const names = (status) => places.filter((p) => p.moderationStatus === status).map((p) => p.name);
  const checking = names('checking');
  const rejected = names('rejected');
  const parts = [];
  if (checking.length) parts.push(`Điểm đang được AI kiểm duyệt: ${checking.join(', ')}`);
  if (rejected.length) parts.push(`Điểm bị AI từ chối, cần sửa: ${rejected.join(', ')}`);
  return {
    key: 'placesModeration',
    ok: parts.length === 0,
    required: true,
    label: parts.length ? parts.join('; ') : 'Mọi điểm dừng đã qua kiểm duyệt AI',
  };
}

// tour.submitted carries at most 50 places: block instead of moderating only a part of the tour.
export const MAX_MODERATED_PLACES = 50;
function placesLimitCheck(places) {
  const ok = places.length <= MAX_MODERATED_PLACES;
  return {
    key: 'placesLimit',
    ok,
    required: true,
    label: ok
      ? `Tối đa ${MAX_MODERATED_PLACES} điểm dừng`
      : `Tour có ${places.length} điểm dừng, tối đa ${MAX_MODERATED_PLACES} để gửi duyệt`,
  };
}
