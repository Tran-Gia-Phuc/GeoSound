// =========================================================
// UC22: admin dashboard and action log, over the gateway /api/tours/admin/...
// Contract: docs/02-design/uc22-dashboard-log.md section 4.
// =========================================================
import { api } from './api.js';

export const LOG_LIMIT = 20;
export const PERIOD_MAX_DAYS = 366;
const DAY_MS = 86_400_000;

/** Removes empty values so the API only gets the filters that are set. */
function query(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') sp.set(k, String(v).trim());
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * GET /api/tours/admin/dashboard?from&to -> { from, to, pendingReview: { pending_review, ai_warning, total },
 *   averageReviewHours, reportedTours, openReportTours, topContributors: [{ authorId, publicTours,
 *   averageRating }], actionsByType: { <action>: n } }
 * Without from/to the backend uses the last 7 days.
 */
export function getDashboard({ from, to } = {}, opts) {
  return api.get(`/api/tours/admin/dashboard${query({ from, to })}`, { ...opts, auth: true });
}

/**
 * GET /api/tours/admin/actions?adminId&action&targetType&targetId&from&to&page&limit ->
 * { items: [{ id, adminId, action, targetType, targetId, reason, data, createdAt }], page, limit, total }
 */
export function listAdminActions({ adminId, action, targetType, targetId, from, to, page = 1, limit = LOG_LIMIT } = {}, opts) {
  return api.get(
    `/api/tours/admin/actions${query({ adminId, action, targetType, targetId, from, to, page, limit })}`,
    { ...opts, auth: true },
  );
}

/** GET /api/tours/admin/actions/:id -> one item (404 admin_action_not_found). */
export function getAdminAction(id, opts) {
  return api.get(`/api/tours/admin/actions/${encodeURIComponent(id)}`, { ...opts, auth: true });
}

/** Date -> "YYYY-MM-DD" in UTC (the backend reads a date-only value as a whole UTC day). */
export const utcDate = (d) => d.toISOString().slice(0, 10);

/** Preset period of `days` days ending today (UTC dates, `to` included). */
export function presetPeriod(days, now = new Date()) {
  return { from: utcDate(new Date(now.getTime() - (days - 1) * DAY_MS)), to: utcDate(now) };
}

/** Checks a custom period: both dates, from <= to, at most 366 days. Error text or null. */
export function periodError(from, to) {
  if (!from || !to) return 'Vui lòng chọn đủ ngày bắt đầu và ngày kết thúc';
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'Ngày không hợp lệ';
  if (a > b) return 'Ngày bắt đầu phải trước ngày kết thúc';
  if ((b - a) / DAY_MS + 1 > PERIOD_MAX_DAYS) return `Khoảng thời gian tối đa ${PERIOD_MAX_DAYS} ngày`;
  return null;
}

/** Labels of the known `data` keys of a log row (detail screen). */
export const ACTION_DATA_LABELS = {
  fromStatus: 'Trạng thái trước',
  status: 'Trạng thái',
  reportCount: 'Số báo cáo được đóng',
  queuedAt: 'Vào hàng chờ duyệt lúc',
  until: 'Tạm khoá đến',
};

export const TARGET_TYPE_LABELS = { tour: 'Tour', user: 'Tài khoản' };
