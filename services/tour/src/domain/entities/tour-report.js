// =========================================================
// UC06 (#268) — a community report of a public tour by one account (docs/02-design/uc06-reports.md).
// Pure: input rules R3 and the review-flag threshold R5. The reporter id never leaves the service
// towards the contributor (R7): the views below do not carry it.
// =========================================================
import { ValidationError } from '../errors/index.js';

// Same list as REPORT_REASONS in shared/events (tour.reported); kept here so the domain stays pure.
export const REPORT_REASONS = Object.freeze(['false_info', 'offensive', 'spam', 'copyright', 'other']);
export const REPORT_STATUS = Object.freeze({ OPEN: 'open', DISMISSED: 'dismissed', ACTIONED: 'actioned' });
export const REPORT_NOTE_MAX = 500;
// R5 — reports from 5 distinct accounts within the last 7 days flag the tour for admin review (UC20).
export const REPORT_FLAG_THRESHOLD = 5;
export const REPORT_WINDOW_DAYS = 7;

export const MSG_REASON_REQUIRED = 'Vui lòng chọn lý do báo cáo';
export const MSG_NOTE_REQUIRED = 'Vui lòng mô tả lý do';

/** R3 — reason from the list (E2), note trimmed, empty -> null, at most 500 characters, required for `other`. */
export function normalizeReportInput({ reason, note } = {}) {
  if (reason === undefined || reason === null || reason === '') {
    throw new ValidationError(MSG_REASON_REQUIRED, { reason: MSG_REASON_REQUIRED });
  }
  if (!REPORT_REASONS.includes(reason)) throw new ValidationError('Lý do báo cáo không hợp lệ', { reason: 'Lý do báo cáo không hợp lệ' });
  let text = note === undefined || note === null ? null : String(note).trim();
  if (text === '') text = null;
  if (text && text.length > REPORT_NOTE_MAX) {
    throw new ValidationError(`Mô tả tối đa ${REPORT_NOTE_MAX} ký tự`, { note: `Mô tả tối đa ${REPORT_NOTE_MAX} ký tự` });
  }
  if (reason === 'other' && !text) throw new ValidationError(MSG_NOTE_REQUIRED, { note: MSG_NOTE_REQUIRED });
  return { reason, note: text };
}

/** R5 — start of the counting window (open reports created at or after it count). */
export function reportWindowStart(now = new Date()) {
  return new Date(now.getTime() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** R5 — true when the number of distinct recent reporters reaches the threshold. */
export function reachesFlagThreshold(distinctRecentReporters) {
  return distinctRecentReporters >= REPORT_FLAG_THRESHOLD;
}

export class TourReport {
  /**
   * @param {{ id?: string, tourId: string, reporterId: string, reason: string, note?: string|null,
   *           status?: string, createdAt?: Date }} props
   */
  constructor(props) {
    this.id = props.id;
    this.tourId = props.tourId;
    this.reporterId = props.reporterId;
    this.reason = props.reason;
    this.note = props.note ?? null;
    this.status = props.status ?? REPORT_STATUS.OPEN;
    this.createdAt = props.createdAt;
  }

  /** View for the reporter right after the submit. */
  toCreated() {
    return { id: this.id, reason: this.reason, note: this.note, createdAt: this.createdAt };
  }

  /** View for "my report" (client shows the "already reported" state). */
  toMine() {
    return { reason: this.reason, note: this.note, createdAt: this.createdAt };
  }
}
