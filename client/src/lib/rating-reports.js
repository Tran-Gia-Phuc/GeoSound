// =========================================================
// UC05 — Client API helpers for rating abuse reports & admin resolution.
// =========================================================
import { api } from './api.js';

export const RATING_REPORT_REASONS = [
  { value: 'SPAM', label: 'Spam / Quảng cáo' },
  { value: 'OFFENSIVE', label: 'Ngôn từ thù ghét / Xúc phạm' },
  { value: 'MISLEADING', label: 'Thông tin sai lệch / Lạc đề' },
  { value: 'OTHER', label: 'Khác' },
];

export const RATING_REPORT_DESC_MAX = 500;

export function submitRatingReport(tourId, ratingId, { reasonType, description }) {
  const desc = (description ?? '').trim();
  return api.post(
    `/api/tours/${encodeURIComponent(tourId)}/ratings/${encodeURIComponent(ratingId)}/reports`,
    { reasonType, description: desc || null },
    { auth: true },
  );
}

export function listAdminRatingReports({ status = 'pending', page = 1, limit = 20 } = {}, opts) {
  const q = new URLSearchParams({ status, page: String(page), limit: String(limit) });
  return api.get(`/api/tours/admin/rating-reports?${q.toString()}`, { ...opts, auth: true });
}

export function resolveRatingReport(reportId, { action, adminNote }) {
  const note = (adminNote ?? '').trim();
  return api.post(
    `/api/tours/admin/rating-reports/${encodeURIComponent(reportId)}/resolve`,
    { action, adminNote: note || null },
    { auth: true },
  );
}
