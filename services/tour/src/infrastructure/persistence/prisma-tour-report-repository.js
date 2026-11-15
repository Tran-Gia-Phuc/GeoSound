// =========================================================
// UC06 (#268) — impl of TourReportRepository with Prisma (table tour_reports).
// createReport runs one transaction:
//   1. lock the tour row (SELECT ... FOR UPDATE): concurrent reports of one tour run one after the
//      other, so they cannot both miss the threshold, and a second report of the same account waits
//      and then hits the unique key (P2002 -> null -> 409);
//   2. insert the report;
//   3. count distinct reporters of the open reports created since windowStart (the new row included);
//   4. one raw UPDATE of tours: open_report_count + 1 and report_flagged_at = now() only when it is
//      null and the threshold is reached. Raw SQL so tours.updated_at (moderation / catalog
//      revision) never moves, which a Prisma `update` would do through @updatedAt.
// =========================================================
import { Prisma } from '@prisma/client';
import { TourReport, REPORT_STATUS } from '../../domain/entities/tour-report.js';
import { TourNotFoundError } from '../../domain/errors/index.js';
import { schemaFromUrl, SQL_IDENTIFIER } from './schema-name.js';

const toEntity = (row) => (row ? new TourReport(row) : null);

/** @implements {import('../../domain/ports/index.js').TourReportRepository} */
export class PrismaTourReportRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma @param {{ schema?: string }} [opts] */
  constructor(prisma, { schema = schemaFromUrl(process.env.DATABASE_URL) } = {}) {
    if (!SQL_IDENTIFIER.test(schema)) throw new Error(`invalid schema name: ${schema}`);
    this.prisma = prisma;
    this.toursTable = Prisma.raw(`"${schema}"."tours"`);
    this.reportsTable = Prisma.raw(`"${schema}"."tour_reports"`);
  }

  async findByTourAndReporter(tourId, reporterId) {
    return toEntity(await this.prisma.tourReport.findUnique({ where: { tourId_reporterId: { tourId, reporterId } } }));
  }

  async createReport({ tourId, reporterId, reason, note }, { windowStart, threshold }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw(Prisma.sql`
          SELECT report_flagged_at AS "flaggedAt" FROM ${this.toursTable} WHERE id = ${tourId} FOR UPDATE`);
        if (!locked.length) throw new TourNotFoundError(); // deleted since the public check

        const row = await tx.tourReport.create({ data: { tourId, reporterId, reason, note } });

        // Prisma maps the Date to the timestamp(3) column the same way it wrote created_at.
        const recent = await tx.tourReport.findMany({
          where: { tourId, status: REPORT_STATUS.OPEN, createdAt: { gte: windowStart } },
          distinct: ['reporterId'],
          select: { reporterId: true },
        });
        const reached = recent.length >= threshold;

        const [tour] = await tx.$queryRaw(Prisma.sql`
          UPDATE ${this.toursTable}
             SET open_report_count = open_report_count + 1,
                 report_flagged_at = CASE
                   WHEN report_flagged_at IS NULL AND ${reached}::boolean THEN (now() AT TIME ZONE 'UTC')
                   ELSE report_flagged_at
                 END
           WHERE id = ${tourId}
       RETURNING open_report_count AS "openReportCount", report_flagged_at AS "flaggedAt"`);

        return {
          report: toEntity(row),
          openReportCount: Number(tour.openReportCount),
          recentReporters: recent.length,
          flagged: tour.flaggedAt !== null,
          flaggedNow: locked[0].flaggedAt === null && tour.flaggedAt !== null,
        };
      });
    } catch (err) {
      // The account already reported this tour (unique tour + reporter).
      if (err?.code === 'P2002') return null;
      throw err;
    }
  }
}
