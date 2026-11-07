// =========================================================
// UC15 — submit a tour for review (AI moderation, then Admin review in UC19).
// Vietnamese labels for every moderation status / category / field in ONE place,
// plus small pure helpers used by the Studio publish step and the places editor.
// The backend contract (services/tour):
//   - GET  /api/tours/mine/:id/readiness -> checks contain 'placesModeration' only when
//     the server runs in moderation mode (MODERATION_EVENTS_ENABLED); otherwise it publishes directly.
//   - POST /api/tours/mine/:id/publish   -> { tour } with status 'ai_checking' (sent to moderation)
//     or 'public' (published directly).
//   - GET  /api/tours/mine/:id           -> { tour } with status, moderationReasons[], reviewReason.
//   - places carry moderationStatus ('checking' | 'approved' | 'warning' | 'rejected') + moderationReasons[].
// =========================================================

/** The server sends the tour to AI moderation instead of publishing it (D2). */
export const isModerationMode = (readiness) =>
  !!readiness?.checks?.some((c) => c.key === 'placesModeration');

// Tour statuses that are inside the review pipeline: the author waits, no new submit.
export const IN_REVIEW_STATUSES = new Set(['ai_checking', 'ai_warning', 'pending_review']);

/** Polling interval of the long-running AI check (#114). */
export const POLL_INTERVAL_MS = 5000;

// AI / geo categories (moderation-architecture.md: hate, violence, sexual, scam, misleading,
// irrelevant, other from AI; route from the Moderation geo rules).
export const CATEGORY_LABELS = {
  hate: 'Thù ghét, xúc phạm',
  violence: 'Bạo lực',
  sexual: 'Nội dung nhạy cảm',
  scam: 'Lừa đảo, quảng cáo',
  misleading: 'Thông tin sai lệch',
  irrelevant: 'Không liên quan',
  route: 'Lộ trình, vị trí',
  other: 'Khác',
};
export const categoryLabel = (c) => CATEGORY_LABELS[c] || CATEGORY_LABELS.other;

export const SOURCE_LABELS = { ai: 'AI', geo: 'Kiểm tra vị trí' };
export const sourceLabel = (s) => SOURCE_LABELS[s] || SOURCE_LABELS.ai;

// Field a reason points at: tour (title, description, coherence, route, places[i]) or place
// (name, description, images[i]); 'general' = a rejection without details.
const FIELD_LABELS = {
  title: 'Tên tour',
  name: 'Tên địa điểm',
  description: 'Mô tả',
  coherence: 'Tính nhất quán của tour',
  route: 'Lộ trình',
  general: 'Chung',
};
export function fieldLabel(field) {
  if (typeof field !== 'string' || !field) return FIELD_LABELS.general;
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const place = /^places\[(\d+)\]$/.exec(field);
  if (place) return `Điểm dừng ${Number(place[1]) + 1}`;
  const image = /^images\[(\d+)\]$/.exec(field);
  if (image) return `Ảnh ${Number(image[1]) + 1}`;
  return field;
}

// Geo reasons of a tour scan end with " (placeId <id>)" (run-tour-review.js): split it out so the
// screen can name the place and link to it instead of showing a raw id.
export function splitPlaceRef(message) {
  const text = typeof message === 'string' ? message : '';
  const m = /\s*\(placeId ([^)\s]+)\)\s*$/.exec(text);
  return m ? { text: text.slice(0, m.index), placeId: m[1] } : { text, placeId: null };
}

// Place moderation chip (#137). 'approved' is the default of every place when moderation is off,
// so the screens show it only in moderation mode.
export const PLACE_MODERATION_META = {
  checking: { label: 'AI đang kiểm duyệt', tone: 'info', icon: 'loader' },
  approved: { label: 'Đã qua kiểm duyệt', tone: 'live', icon: 'check-circle' },
  warning: { label: 'Cảnh báo AI', tone: 'warn', icon: 'alert-triangle' },
  rejected: { label: 'Bị AI từ chối', tone: 'danger', icon: 'x' },
};
export const placeModerationMeta = (s) => PLACE_MODERATION_META[s] || null;

/** D5 — places that block a submission ('warning' does not block). */
export const blockingPlaces = (places) =>
  (places || []).filter((p) => p.moderationStatus === 'checking' || p.moderationStatus === 'rejected');

// Forbidden zone types (services/tour ForbiddenZone.type).
export const ZONE_TYPE_LABELS = {
  military: 'Khu quân sự',
  school: 'Trường học',
  hospital: 'Bệnh viện',
  consulate: 'Lãnh sự quán',
  other: 'Khu vực hạn chế',
};
export const zoneTypeLabel = (t) => ZONE_TYPE_LABELS[t] || ZONE_TYPE_LABELS.other;

/**
 * What the publish step shows for the current tour status (#110, #111, #112, #114).
 * @returns {null | { kind: string, tone: string, title: string, text: string }}
 */
export function submissionResult(tour) {
  if (!tour) return null;
  const reasons = Array.isArray(tour.moderationReasons) ? tour.moderationReasons : [];
  switch (tour.status) {
    case 'ai_checking':
      return {
        kind: 'checking',
        tone: 'info',
        title: 'AI đang kiểm duyệt tour',
        text: 'Hệ thống đang quét nội dung và vị trí các điểm dừng. Trang tự cập nhật khi có kết quả.',
      };
    case 'pending_review':
      return {
        kind: 'pending',
        tone: 'info',
        title: 'Đang chờ Admin duyệt',
        text: 'AI không phát hiện vấn đề. Tour đã vào hàng chờ duyệt của Admin; bạn sẽ nhận thông báo khi có kết quả.',
      };
    case 'ai_warning':
      return {
        kind: 'warning',
        tone: 'warn',
        title: 'Đang chờ Admin duyệt — có cảnh báo AI',
        text: 'AI ghi nhận một số điểm cần lưu ý. Tour vẫn vào hàng chờ của Admin, Admin sẽ xem các lý do dưới đây.',
      };
    case 'changes_requested':
      return {
        kind: 'changes',
        tone: 'warn',
        title: 'Admin yêu cầu chỉnh sửa',
        text: 'Hãy sửa tour theo góp ý của Admin rồi gửi duyệt lại.',
      };
    case 'rejected':
      return {
        kind: 'admin-rejected',
        tone: 'danger',
        title: 'Admin đã từ chối tour',
        text: 'Bạn có thể sửa nội dung theo lý do dưới đây rồi gửi duyệt lại.',
      };
    case 'draft':
      // ai_rejected -> draft with the reasons (they are cleared on the next submit).
      return reasons.length
        ? {
            kind: 'ai-rejected',
            tone: 'danger',
            title: 'AI đã từ chối lần gửi duyệt trước',
            text: 'Tour đã về Nháp. Sửa các mục dưới đây rồi gửi duyệt lại.',
          }
        : null;
    default:
      return null;
  }
}

/** "1 phút 05 giây" — elapsed time of the AI check (#114). */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} giờ ${String(m).padStart(2, '0')} phút`;
  if (m) return `${m} phút ${String(s).padStart(2, '0')} giây`;
  return `${s} giây`;
}

export const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
/** Backend message (Vietnamese) when there is one; a fixed sentence for network errors. */
export const errorText = (err, fallback) => (err?.offline ? OFFLINE_MESSAGE : err?.message || fallback);
