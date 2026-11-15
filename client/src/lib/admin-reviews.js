// =========================================================
// UC19: admin review of submitted tours (tier 2 of moderation), over the gateway
// /api/tours/admin/reviews. Contract: docs/02-design/admin-review-api.md.
//   Queue (ai_warning first, then oldest), read-only dossier, approve / reject / request changes.
// Also the Vietnamese labels of the AI / geo moderation reasons (category, field, place status).
// =========================================================
import { api } from './api.js';
import { REASON_MAX } from './admin-reports.js';

const BASE = '/api/tours/admin/reviews';
const path = (tourId, tail = '') => `${BASE}/${encodeURIComponent(tourId)}${tail}`;

export { REASON_MAX };

/** Vietnamese labels of the moderation categories (AI categories + `route` from the geo rules). */
export const MODERATION_CATEGORY_LABELS = {
  hate: 'Thù ghét',
  violence: 'Bạo lực',
  sexual: 'Nội dung tình dục',
  scam: 'Lừa đảo',
  misleading: 'Sai lệch thông tin',
  irrelevant: 'Không liên quan',
  route: 'Lộ trình',
  other: 'Khác',
};
export const categoryLabel = (c) => MODERATION_CATEGORY_LABELS[c] || c || 'Khác';

/** Source of a reason: the AI model or the Moderation geo rules. */
export const REASON_SOURCE_LABELS = { ai: 'AI', geo: 'Kiểm tra vị trí' };
export const sourceLabel = (s) => REASON_SOURCE_LABELS[s] || null;

/**
 * Vietnamese label of a reason `field`: title, description, coherence (tour), name,
 * description, images[i] (place), places[i] and route (geo rules).
 */
export function fieldLabel(field) {
  if (!field) return 'Chung';
  const fixed = {
    title: 'Tên tour',
    description: 'Mô tả',
    coherence: 'Tính nhất quán',
    name: 'Tên điểm',
    route: 'Lộ trình',
    images: 'Hình ảnh',
  };
  if (fixed[field]) return fixed[field];
  const m = /^(images|places)\[(\d+)\]$/.exec(field);
  if (m) return m[1] === 'images' ? `Ảnh ${Number(m[2]) + 1}` : `Điểm ${Number(m[2]) + 1}`;
  return field;
}

/** UC15 place moderation status (PLACE_MODERATION in the Tour service). */
export const PLACE_MODERATION_META = {
  checking: { label: 'Đang kiểm duyệt AI', tone: 'info' },
  approved: { label: 'AI đạt', tone: 'live' },
  warning: { label: 'Cảnh báo AI', tone: 'warn' },
  rejected: { label: 'AI từ chối', tone: 'danger' },
};
export const placeModerationMeta = (s) =>
  PLACE_MODERATION_META[s] || { label: s || 'Không rõ', tone: 'neutral' };

/** Decisions of the review log (TourReviewAction.action). */
export const REVIEW_ACTION_LABELS = {
  approve: 'Duyệt',
  reject: 'Từ chối',
  request_changes: 'Yêu cầu chỉnh sửa',
};
export const reviewActionLabel = (a) => REVIEW_ACTION_LABELS[a] || a;

/** Shown on a 409 (the tour left ai_warning / pending_review) and for a non-reviewable dossier. */
export const NOT_REVIEWABLE_MESSAGE = 'Tour không còn ở trạng thái chờ duyệt';

/**
 * Per-stop notes of a change request joined into the one reason string the API takes:
 *   "<general note>\nĐiểm 2 – <name>: <note>" (empty notes skipped, everything trimmed).
 * @param {string} general
 * @param {Array<{ index: number, name?: string, note?: string }>} stops  index is 0-based
 */
export function joinChangeRequest(general, stops = []) {
  const lines = [];
  const head = (general ?? '').trim();
  if (head) lines.push(head);
  for (const s of stops) {
    const note = (s.note ?? '').trim();
    if (!note) continue;
    const name = (s.name ?? '').trim();
    lines.push(`Điểm ${s.index + 1}${name ? ` – ${name}` : ''}: ${note}`);
  }
  return lines.join('\n');
}

/**
 * GET /api/tours/admin/reviews -> { tours: [{ id, title, coverImageUrl, originalLanguage, type,
 *   city, status, aiWarning, authorId, moderationReasons, submittedAt }] }
 * Ordered by the API (ai_warning first, then oldest first); not paged.
 */
export function listReviewQueue(opts) {
  return api.get(BASE, { ...opts, auth: true });
}

/**
 * GET /api/tours/admin/reviews/:tourId -> { tour, reviewable, places, routeConfig, history }
 */
export function getReviewDossier(tourId, opts) {
  return api.get(path(tourId), { ...opts, auth: true });
}

/** POST /:tourId/approve -> { message, tour, action: 'approve' } */
export function approveTour(tourId) {
  return api.post(path(tourId, '/approve'), {}, { auth: true });
}

/** POST /:tourId/reject { reason } (1..1000, trimmed) */
export function rejectTour(tourId, reason) {
  return api.post(path(tourId, '/reject'), { reason: (reason ?? '').trim() }, { auth: true });
}

/** POST /:tourId/request-changes { reason } (1..1000, trimmed) */
export function requestTourChanges(tourId, reason) {
  return api.post(path(tourId, '/request-changes'), { reason: (reason ?? '').trim() }, { auth: true });
}
