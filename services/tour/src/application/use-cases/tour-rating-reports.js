// =========================================================
// UC05 — Rating abuse report & admin resolution use cases:
//   - SubmitRatingReport     : Tourist/Author reports a visible rating on a public tour
//   - ListAdminRatingReports : Admin lists reports by status (pending/resolved/dismissed)
//   - ResolveRatingReport    : Admin removes the rating (recalculating tour stats) or dismisses
// =========================================================
import {
  REPORT_STATUSES,
  normalizeReportInput,
} from '../../domain/entities/tour-rating-report.js';
import {
  TourNotFoundError,
  RatingNotFoundError,
  CannotReportOwnRatingError,
  RatingReportAlreadySubmittedError,
  RatingReportNotFoundError,
} from '../../domain/errors/index.js';

export const RATING_REPORTS_PAGE_DEFAULT = 20;
export const RATING_REPORTS_PAGE_MAX = 50;

export class SubmitRatingReport {
  /** @param {{ tourRepo, reportRepo }} deps */
  constructor({ tourRepo, reportRepo }) {
    this.tourRepo = tourRepo;
    this.reportRepo = reportRepo;
  }

  async execute({ tourId, ratingUserId, reporterId, reasonType, description }) {
    const input = normalizeReportInput({ reasonType, description });
    const tour = await this.tourRepo.findPublicById(tourId);
    if (!tour) throw new TourNotFoundError();

    const rating = await this.reportRepo.findVisibleRating(tourId, ratingUserId);
    if (!rating) throw new RatingNotFoundError('Không tìm thấy đánh giá này');
    if (rating.userId === reporterId) throw new CannotReportOwnRatingError();

    const reporterRole = tour.isOwnedBy(reporterId) ? 'AUTHOR' : 'TOURIST';
    const created = await this.reportRepo.createReport({
      tourId,
      ratingId: rating.id,
      ratingUserId: rating.userId,
      reporterId,
      reporterRole,
      ...input,
    });
    if (!created) throw new RatingReportAlreadySubmittedError();
    return created;
  }
}

export class ListAdminRatingReports {
  /** @param {{ reportRepo }} deps */
  constructor({ reportRepo }) {
    this.reportRepo = reportRepo;
  }

  async execute({ status = 'pending', page = 1, limit = RATING_REPORTS_PAGE_DEFAULT } = {}) {
    const normalizedStatus = String(status || 'pending').trim().toUpperCase();
    const targetStatus = Object.values(REPORT_STATUSES).includes(normalizedStatus)
      ? normalizedStatus
      : REPORT_STATUSES.PENDING;
    const take = Math.min(Math.max(1, Number(limit) || RATING_REPORTS_PAGE_DEFAULT), RATING_REPORTS_PAGE_MAX);
    const current = Math.max(1, Number(page) || 1);
    const { items, total } = await this.reportRepo.listAdminReports({
      status: targetStatus,
      skip: (current - 1) * take,
      take,
    });
    return { items, page: current, limit: take, total, status: targetStatus };
  }
}

export class ResolveRatingReport {
  /** @param {{ reportRepo }} deps */
  constructor({ reportRepo }) {
    this.reportRepo = reportRepo;
  }

  async execute({ reportId, action, adminId, adminNote }) {
    const note = typeof adminNote === 'string' && adminNote.trim() ? adminNote.trim() : null;
    const result = await this.reportRepo.resolveReport({
      reportId,
      action,
      adminId,
      adminNote: note,
    });
    if (!result) throw new RatingReportNotFoundError();
    return result;
  }
}
