// =========================================================
// Tour reports (UC06, #268) over the gateway /api/tours/:id/reports. Signed in only.
// =========================================================
import { api } from './api.js';

export const REPORT_NOTE_MAX = 500;

/** Reason codes of the API (R3) with their Vietnamese labels, in display order. */
export const REPORT_REASONS = [
  { value: 'false_info', label: 'Sai sự thật' },
  { value: 'offensive', label: 'Phản cảm' },
  { value: 'spam', label: 'Spam' },
  { value: 'copyright', label: 'Vi phạm bản quyền' },
  { value: 'other', label: 'Khác' },
];

export const reportReasonLabel = (value) => REPORT_REASONS.find((r) => r.value === value)?.label || value;

const base = (tourId) => `/api/tours/${encodeURIComponent(tourId)}/reports`;

/** GET /:id/reports/mine -> { reason, note, createdAt } | null */
export async function getMyReport(tourId, opts) {
  const body = await api.get(`${base(tourId)}/mine`, { ...opts, auth: true });
  return body?.report ?? null;
}

/**
 * POST /:id/reports { reason, note? } -> 201 { report: { id, reason, note, createdAt }, flagged }
 * Errors: 400 validation_error, 403 own_tour, 404 tour_not_found, 409 already_reported.
 */
export function reportTour(tourId, { reason, note }) {
  const text = (note ?? '').trim();
  return api.post(base(tourId), text ? { reason, note: text } : { reason }, { auth: true });
}
