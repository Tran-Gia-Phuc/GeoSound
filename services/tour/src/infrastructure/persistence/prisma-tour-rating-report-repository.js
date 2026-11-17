// =========================================================
// UC05 — Prisma repository for tour_rating_reports.
// Reuses the atomic aggregate SQL pattern from PrismaTourRatingRepository (no updated_at bump).
// =========================================================
import { Prisma } from '@prisma/client';
import { ratingDelta } from '../../domain/entities/tour-rating.js';
import {
  REPORT_STATUSES,
  RESOLVE_ACTIONS,
  SOFT_FLAG_THRESHOLD,
} from '../../domain/entities/tour-rating-report.js';
import { schemaFromUrl, SQL_IDENTIFIER } from './schema-name.js';

const toSummary = (row) => ({
  averageRating: Number(row?.averageRating ?? 0),
  ratingCount: Number(row?.ratingCount ?? 0),
});

export class PrismaTourRatingReportRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma @param {{ schema?: string }} [opts] */
  constructor(prisma, { schema = schemaFromUrl(process.env.DATABASE_URL) } = {}) {
    if (!SQL_IDENTIFIER.test(schema)) throw new Error(`invalid schema name: ${schema}`);
    this.prisma = prisma;
    this.toursTable = Prisma.raw(`"${schema}"."tours"`);
    this.ratingsTable = Prisma.raw(`"${schema}"."tour_ratings"`);
  }

  async #moveAggregate(tx, tourId, { count, sum }) {
    const rows = await tx.$queryRaw(Prisma.sql`
      UPDATE ${this.toursTable}
         SET rating_count   = GREATEST(rating_count + ${count}::int, 0),
             average_rating = CASE
               WHEN rating_count + ${count}::int <= 0 THEN 0
               ELSE LEAST(GREATEST((average_rating * rating_count + ${sum}::int) / (rating_count + ${count}::int), 0), 5)
             END
       WHERE id = ${tourId}
   RETURNING average_rating AS "averageRating", rating_count AS "ratingCount"`);
    return toSummary(rows[0]);
  }

  /** Accepts either ratingUserId or ratingId so both API contracts work seamlessly. */
  async findVisibleRating(tourId, ratingRef) {
    return this.prisma.tourRating.findFirst({
      where: {
        tourId,
        isHidden: false,
        OR: [{ userId: ratingRef }, { id: ratingRef }],
      },
    });
  }

  async createReport({ tourId, ratingId, ratingUserId, reporterId, reporterRole, reasonType, description }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const report = await tx.tourRatingReport.create({
          data: {
            tourId,
            ratingId,
            ratingUserId,
            reporterId,
            reporterRole,
            reasonType,
            description,
            status: REPORT_STATUSES.PENDING,
          },
        });
        const pendingCount = await tx.tourRatingReport.count({
          where: { ratingId, status: REPORT_STATUSES.PENDING },
        });
        let isFlagged = false;
        if (pendingCount >= SOFT_FLAG_THRESHOLD) {
          await tx.tourRating.update({
            where: { id: ratingId },
            data: { isFlagged: true },
          });
          isFlagged = true;
        } else {
          const rating = await tx.tourRating.findUnique({
            where: { id: ratingId },
            select: { isFlagged: true },
          });
          isFlagged = Boolean(rating?.isFlagged);
        }
        return { report, pendingCount, isFlagged };
      });
    } catch (err) {
      if (err?.code === 'P2002') return null;
      throw err;
    }
  }

  async listAdminReports({ status = REPORT_STATUSES.PENDING, skip = 0, take = 20 }) {
    const [rows, total] = await Promise.all([
      this.prisma.tourRatingReport.findMany({
        where: { status },
        include: {
          rating: {
            include: {
              tour: { select: { id: true, title: true, city: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.tourRatingReport.count({ where: { status } }),
    ]);

    const ratingIds = [...new Set(rows.map((r) => r.ratingId))];
    const pendingCounts = ratingIds.length
      ? await this.prisma.tourRatingReport.groupBy({
          by: ['ratingId'],
          where: { ratingId: { in: ratingIds }, status: REPORT_STATUSES.PENDING },
          _count: { _all: true },
        })
      : [];
    const countMap = new Map(pendingCounts.map((g) => [g.ratingId, g._count._all]));

    const items = rows
      .map((r) => ({
        id: r.id,
        tourId: r.tourId,
        ratingId: r.ratingId,
        ratingUserId: r.ratingUserId,
        reporterId: r.reporterId,
        reporterRole: r.reporterRole,
        reasonType: r.reasonType,
        description: r.description,
        status: r.status,
        adminNote: r.adminNote,
        resolvedBy: r.resolvedBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        pendingCount: countMap.get(r.ratingId) ?? 0,
        rating: r.rating
          ? {
              id: r.rating.id,
              userName: r.rating.userName,
              stars: r.rating.stars,
              comment: r.rating.comment,
              isFlagged: r.rating.isFlagged,
              isHidden: r.rating.isHidden,
            }
          : null,
        tour: r.rating?.tour
          ? {
              id: r.rating.tour.id,
              title: r.rating.tour.title,
              city: r.rating.tour.city,
            }
          : null,
      }))
      .sort((a, b) => {
        const flagDiff = Number(Boolean(b.rating?.isFlagged)) - Number(Boolean(a.rating?.isFlagged));
        if (flagDiff !== 0) return flagDiff;
        const roleDiff = Number(b.reporterRole === 'AUTHOR') - Number(a.reporterRole === 'AUTHOR');
        if (roleDiff !== 0) return roleDiff;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

    return { items, total };
  }

  async resolveReport({ reportId, action, adminId, adminNote }) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.tourRatingReport.findUnique({ where: { id: reportId } });
      if (!target) return null;

      const locked = await tx.$queryRaw(Prisma.sql`
        SELECT id, tour_id AS "tourId", stars, is_hidden AS "isHidden"
          FROM ${this.ratingsTable}
         WHERE id = ${target.ratingId}
           FOR UPDATE`);
      const rating = locked[0];
      if (!rating) return null;

      const nextStatus =
        action === RESOLVE_ACTIONS.REMOVE_RATING ? REPORT_STATUSES.RESOLVED : REPORT_STATUSES.DISMISSED;

      await tx.tourRatingReport.updateMany({
        where: { ratingId: target.ratingId, status: REPORT_STATUSES.PENDING },
        data: { status: nextStatus, adminNote: adminNote ?? null, resolvedBy: adminId },
      });

      let summary;
      if (action === RESOLVE_ACTIONS.DISMISS) {
        await tx.tourRating.update({
          where: { id: rating.id },
          data: { isFlagged: false },
        });
        const t = await tx.tour.findUnique({
          where: { id: rating.tourId },
          select: { averageRating: true, ratingCount: true },
        });
        summary = toSummary(t);
      } else {
        if (!rating.isHidden) {
          await tx.tourRating.update({
            where: { id: rating.id },
            data: { isHidden: true },
          });
          summary = await this.#moveAggregate(tx, rating.tourId, ratingDelta.deleted(rating.stars));
        } else {
          const t = await tx.tour.findUnique({
            where: { id: rating.tourId },
            select: { averageRating: true, ratingCount: true },
          });
          summary = toSummary(t);
        }
      }

      const updated = await tx.tourRatingReport.findUnique({ where: { id: reportId } });
      return { report: updated, status: nextStatus, summary };
    });
  }
}
