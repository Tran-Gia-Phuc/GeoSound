// =========================================================
// UC21: admin account actions.
//   Auth  /api/auth/admin/users...            (docs/02-design/uc21-account-actions.md section 4)
//   Tour  /api/tours/admin/users/:id/violations (docs/02-design/uc22-dashboard-log.md section 4)
// =========================================================
import { api } from './api.js';

const BASE = '/api/auth/admin/users';
const path = (id, tail = '') => `${BASE}/${encodeURIComponent(id)}${tail}`;

export const USERS_LIMIT = 20;

/** Suspension presets (days) and the furthest end date (R3). */
export const SUSPEND_PRESETS = [1, 7, 30];
export const SUSPEND_MAX_DAYS = 365;

export const ROLE_LABELS = { tourist: 'Du khách', contributor: 'Tác giả', admin: 'Quản trị viên' };
export const roleLabel = (r) => ROLE_LABELS[r] || r || 'Không rõ';

export const ACCOUNT_STATUS_META = {
  active: { label: 'Đang hoạt động', tone: 'live' },
  suspended: { label: 'Tạm khoá', tone: 'warn' },
  banned: { label: 'Bị cấm', tone: 'danger' },
};
export const accountStatusMeta = (s) => ACCOUNT_STATUS_META[s] || { label: s || 'Không rõ', tone: 'neutral' };

/**
 * GET /api/auth/admin/users?q&role&status&page&limit -> { items, total, page, limit }
 * item: { id, email, fullName, role, status, banReason, suspendedUntil, createdAt }
 */
export function searchUsers({ q, role, status, page = 1, limit = USERS_LIMIT } = {}, opts) {
  const sp = new URLSearchParams();
  if (q && q.trim()) sp.set('q', q.trim());
  if (role) sp.set('role', role);
  if (status) sp.set('status', status);
  sp.set('page', String(page));
  sp.set('limit', String(limit));
  return api.get(`${BASE}?${sp}`, { ...opts, auth: true });
}

/** GET /api/auth/admin/users/:id -> item + { activeSessions } */
export function getUser(id, opts) {
  return api.get(path(id), { ...opts, auth: true });
}

/**
 * GET /api/tours/admin/users/:id/violations ->
 * { userId, tours: { total, public, hidden, rejected }, hiddenTours: [{ id, title, hiddenAt, reason }],
 *   rejectedTours: [{ id, title, rejectedAt, reason }], reports: { open, dismissed, actioned },
 *   accountActions: [AdminAction] }
 */
export function getUserViolations(id, opts) {
  return api.get(`/api/tours/admin/users/${encodeURIComponent(id)}/violations`, { ...opts, auth: true });
}

/** POST /:id/warn { reason } */
export function warnUser(id, reason) {
  return api.post(path(id, '/warn'), { reason }, { auth: true });
}

/** POST /:id/suspend { reason, days } or { reason, until } (exactly one). */
export function suspendUser(id, { reason, days, until }) {
  const body = days !== undefined && days !== null ? { reason, days } : { reason, until };
  return api.post(path(id, '/suspend'), body, { auth: true });
}

/** POST /:id/ban { reason } */
export function banUser(id, reason) {
  return api.post(path(id, '/ban'), { reason }, { auth: true });
}

/** POST /:id/restore { reason? } — an empty box sends no reason. */
export function restoreUser(id, reason) {
  const text = (reason ?? '').trim();
  return api.post(path(id, '/restore'), text ? { reason: text } : {}, { auth: true });
}

/**
 * Local date "yyyy-mm-dd" -> end of that day in local time as ISO (with Z), or null when invalid.
 * The suspension then lasts through the chosen day.
 */
export function endOfLocalDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 0, 0);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Date -> local "yyyy-mm-dd" (for the date picker min/max). */
export function toLocalDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
