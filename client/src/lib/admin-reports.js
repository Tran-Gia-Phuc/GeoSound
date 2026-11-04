// =========================================================
// UC20: admin handling of reported tours, over the gateway /api/tours/admin/reports.
// Contract: docs/02-design/uc20-report-handling.md section 4.
// =========================================================
import { api } from './api.js';

const BASE = '/api/tours/admin/reports';
const path = (tourId, tail = '') => `${BASE}/${encodeURIComponent(tourId)}${tail}`;

/** Vietnamese labels of the UC06 report reasons. */
export const REPORT_REASON_LABELS = {
  false_info: 'Sai sự thật',
  offensive: 'Phản cảm',
  spam: 'Spam',
  copyright: 'Vi phạm bản quyền',
  other: 'Khác',
};
export const reasonLabel = (r) => REPORT_REASON_LABELS[r] || r || 'Khác';

/** Vietnamese labels of the admin_actions log entries (UC20 tours, UC21 accounts). */
export const ADMIN_ACTION_LABELS = {
  hide_tour: 'Ẩn tour',
  restore_tour: 'Khôi phục tour',
  dismiss_reports: 'Bỏ qua báo cáo',
  warn_user: 'Cảnh báo tài khoản',
  suspend_user: 'Tạm khoá tài khoản',
  ban_user: 'Cấm tài khoản',
  restore_user: 'Khôi phục tài khoản',
};
export const actionLabel = (a) => ADMIN_ACTION_LABELS[a] || a;

/** Hide reason limits (R3). */
export const REASON_MAX = 1000;

/** Page size of the queue (backend default 20, max 50). */
export const QUEUE_LIMIT = 20;

/**
 * GET /api/tours/admin/reports?page&limit ->
 * { tours: [{ tourId, title, status, authorId, openReportCount, flagged, flaggedAt, lastReportAt,
 *             reasons: { <reason>: count } }], page, limit, total }
 */
export function listReportedTours({ page = 1, limit = QUEUE_LIMIT } = {}, opts) {
  const q = new URLSearchParams({ page: String(page), limit: String(limit) });
  return api.get(`${BASE}?${q}`, { ...opts, auth: true });
}

/**
 * GET /api/tours/admin/reports/:tourId ->
 * { tour, reports: { openReportCount, flagged, flaggedAt, open[], dismissedCount, actionedCount },
 *   actions: { hide, restore, dismiss }, history: [AdminAction] }
 */
export function getReportDossier(tourId, opts) {
  return api.get(path(tourId), { ...opts, auth: true });
}

/** POST /:tourId/hide { reason } (required, 1..1000). */
export function hideReportedTour(tourId, reason) {
  return api.post(path(tourId, '/hide'), { reason }, { auth: true });
}

/** Optional reason: an empty box sends no reason at all. */
const optionalReason = (reason) => {
  const text = (reason ?? '').trim();
  return text ? { reason: text } : {};
};

/** POST /:tourId/restore { reason? } */
export function restoreReportedTour(tourId, reason) {
  return api.post(path(tourId, '/restore'), optionalReason(reason), { auth: true });
}

/** POST /:tourId/dismiss { reason? } */
export function dismissTourReports(tourId, reason) {
  return api.post(path(tourId, '/dismiss'), optionalReason(reason), { auth: true });
}
