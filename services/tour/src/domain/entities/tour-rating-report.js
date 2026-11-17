// =========================================================
// UC05 — Rating abuse report & author dispute domain rules.
// =========================================================
import { ValidationError } from '../errors/index.js';

export const REPORT_REASONS = Object.freeze({
  SPAM: 'SPAM',
  OFFENSIVE: 'OFFENSIVE',
  MISLEADING: 'MISLEADING',
  OTHER: 'OTHER',
});

export const REPORT_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
});

export const RESOLVE_ACTIONS = Object.freeze({
  REMOVE_RATING: 'REMOVE_RATING',
  DISMISS: 'DISMISS',
});

export const SOFT_FLAG_THRESHOLD = 3;
export const REPORT_DESCRIPTION_MAX = 500;
export const ADMIN_NOTE_MAX = 500;

const VALID_REASONS = new Set(Object.values(REPORT_REASONS));

/** Normalize & validate rating report payload (R4, max 500 chars description). */
export function normalizeReportInput({ reasonType, description } = {}) {
  const reason = typeof reasonType === 'string' ? reasonType.trim().toUpperCase() : '';
  if (!VALID_REASONS.has(reason)) {
    throw new ValidationError('Vui lòng chọn lý do báo cáo hợp lệ', {
      reasonType: 'Lý do báo cáo không hợp lệ',
    });
  }
  let text = description === undefined || description === null ? null : String(description).trim();
  if (text === '') text = null;
  if (text && text.length > REPORT_DESCRIPTION_MAX) {
    throw new ValidationError(`Mô tả tối đa ${REPORT_DESCRIPTION_MAX} ký tự`, {
      description: `Mô tả tối đa ${REPORT_DESCRIPTION_MAX} ký tự`,
    });
  }
  return { reasonType: reason, description: text };
}

export class TourRatingReport {
  constructor(props) {
    this.id = props.id;
    this.tourId = props.tourId;
    this.ratingId = props.ratingId;
    this.ratingUserId = props.ratingUserId;
    this.reporterId = props.reporterId;
    this.reporterRole = props.reporterRole;
    this.reasonType = props.reasonType;
    this.description = props.description ?? null;
    this.status = props.status ?? REPORT_STATUSES.PENDING;
    this.adminNote = props.adminNote ?? null;
    this.resolvedBy = props.resolvedBy ?? null;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
