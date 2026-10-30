// =========================================================
// UC19 — read side of the admin decision log (table tour_review_actions).
// Rows are written by PrismaTourRepository.applyReviewDecisionIf, in the same transaction as the
// status change, so a decision is never saved without its log row.
// =========================================================
import { TourReviewAction } from '../../domain/entities/tour-review-action.js';

/** @implements {import('../../domain/ports/index.js').TourReviewActionRepository} */
export class PrismaTourReviewActionRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  static toEntity(row) {
    if (!row) return null;
    return new TourReviewAction(row);
  }

  /** Review history of one tour, newest first. */
  async listByTour(tourId) {
    const rows = await this.prisma.tourReviewAction.findMany({
      where: { tourId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(PrismaTourReviewActionRepository.toEntity);
  }
}
