// =========================================================
// UC20 (#273) — impl of AdminReportRepository with Prisma (tables tours, tour_reports, admin_actions).
// Read side: the report queue (R1 order in SQL) and the report state of one tour.
// Write side: hide / restore / dismiss. Each one is ONE transaction:
//   1. a conditional write on the tour row (WHERE status = ... / open_report_count > 0). It takes the
//      row lock, so of two admins acting at once the second re-checks the condition after the first
//      commits, matches nothing and gets null (-> 409);
//   2. the open reports of the tour move to `actioned` (hide) or `dismissed` (dismiss);
//   3. one admin_actions row (append-only log, decision L14).
// Hide / restore change the status through Prisma (updated_at moves: catalog revision). Dismiss only
// resets counters, so it uses raw SQL: tours.updated_at must not move (same as UC06).
// =========================================================
import { Prisma } from '@prisma/client';
import { TourReport, REPORT_STATUS } from '../../domain/entities/tour-report.js';
import { ADMIN_ACTION, ADMIN_TARGET } from '../../domain/entities/admin-action.js';
import { TOUR_STATUS } from '../../domain/entities/tour.js';
import { schemaFromUrl, SQL_IDENTIFIER } from './schema-name.js';

const toDate = (v) => (v ? new Date(v) : null);

/** @implements {import('../../domain/ports/index.js').AdminReportRepository} */
export class PrismaAdminReportRepository {
  /**
   * @param {import('@prisma/client').PrismaClient} prisma
   * @param {{ actionLog: import('../../domain/ports/index.js').AdminActionRepository, schema?: string }} opts
   */
  constructor(prisma, { actionLog, schema = schemaFromUrl(process.env.DATABASE_URL) }) {
    if (!actionLog) throw new Error('PrismaAdminReportRepository: actionLog is required');
    if (!SQL_IDENTIFIER.test(schema)) throw new Error(`invalid schema name: ${schema}`);
    this.prisma = prisma;
    this.actionLog = actionLog;
    this.toursTable = Prisma.raw(`"${schema}"."tours"`);
    this.reportsTable = Prisma.raw(`"${schema}"."tour_reports"`);
  }

  // ---------- read ----------

  /** R1 — tours with open reports: count desc, flagged first, oldest open report first, then id. */
  async listQueue({ skip, take }) {
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw(Prisma.sql`
        SELECT t.id AS "tourId", t.title, t.status, t.author_id AS "authorId",
               t.open_report_count AS "openReportCount", t.report_flagged_at AS "flaggedAt",
               MIN(r.created_at) AS "oldestReportAt", MAX(r.created_at) AS "lastReportAt"
          FROM ${this.toursTable} t
          LEFT JOIN ${this.reportsTable} r ON r.tour_id = t.id AND r.status = ${REPORT_STATUS.OPEN}
         WHERE t.open_report_count > 0
         GROUP BY t.id
         ORDER BY t.open_report_count DESC,
                  (t.report_flagged_at IS NULL) ASC,
                  MIN(r.created_at) ASC NULLS LAST,
                  t.id ASC
         LIMIT ${take} OFFSET ${skip}`),
      this.prisma.tour.count({ where: { openReportCount: { gt: 0 } } }),
    ]);

    const ids = rows.map((r) => r.tourId);
    const grouped = ids.length
      ? await this.prisma.tourReport.groupBy({
          by: ['tourId', 'reason'],
          where: { tourId: { in: ids }, status: REPORT_STATUS.OPEN },
          _count: { _all: true },
        })
      : [];
    const reasons = new Map(ids.map((id) => [id, {}]));
    for (const g of grouped) reasons.get(g.tourId)[g.reason] = g._count._all;

    return {
      items: rows.map((r) => ({
        tourId: r.tourId,
        title: r.title,
        status: r.status,
        authorId: r.authorId,
        openReportCount: Number(r.openReportCount),
        flaggedAt: toDate(r.flaggedAt),
        oldestReportAt: toDate(r.oldestReportAt),
        lastReportAt: toDate(r.lastReportAt),
        reasons: reasons.get(r.tourId),
      })),
      total,
    };
  }

  /** Report side of the dossier: counters, open reports (newest first) and counts by status. */
  async getReportState(tourId) {
    const [tour, open, grouped] = await Promise.all([
      this.prisma.tour.findUnique({ where: { id: tourId }, select: { openReportCount: true, reportFlaggedAt: true } }),
      this.prisma.tourReport.findMany({
        where: { tourId, status: REPORT_STATUS.OPEN },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.tourReport.groupBy({ by: ['status'], where: { tourId }, _count: { _all: true } }),
    ]);
    if (!tour) return null;
    const counts = { open: 0, dismissed: 0, actioned: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    return {
      openReportCount: tour.openReportCount,
      flaggedAt: tour.reportFlaggedAt,
      open: open.map((row) => new TourReport(row)),
      counts,
    };
  }

  // ---------- conditional writes ----------

  /** R3 — public -> hidden; open reports -> actioned; counters reset; log row. Null when not public. */
  async hideIf(tourId, { adminId, reason }) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.tour.updateMany({
        where: { id: tourId, status: TOUR_STATUS.PUBLIC },
        data: { status: TOUR_STATUS.HIDDEN, openReportCount: 0, reportFlaggedAt: null },
      });
      if (!count) return null;
      const { count: reportCount } = await tx.tourReport.updateMany({
        where: { tourId, status: REPORT_STATUS.OPEN },
        data: { status: REPORT_STATUS.ACTIONED },
      });
      const data = { fromStatus: TOUR_STATUS.PUBLIC, reportCount };
      await this.actionLog.append(
        { adminId, action: ADMIN_ACTION.HIDE_TOUR, targetType: ADMIN_TARGET.TOUR, targetId: tourId, reason, data },
        { tx },
      );
      return data;
    });
  }

  /** R4 — hidden -> public (no new moderation, decision L13); log row. Null when not hidden. */
  async restoreIf(tourId, { adminId, reason = null }) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.tour.updateMany({
        where: { id: tourId, status: TOUR_STATUS.HIDDEN },
        data: { status: TOUR_STATUS.PUBLIC },
      });
      if (!count) return null;
      const data = { fromStatus: TOUR_STATUS.HIDDEN };
      await this.actionLog.append(
        { adminId, action: ADMIN_ACTION.RESTORE_TOUR, targetType: ADMIN_TARGET.TOUR, targetId: tourId, reason, data },
        { tx },
      );
      return data;
    });
  }

  /**
   * R5 — open reports -> dismissed, counters reset, status unchanged; log row. Null when the tour has
   * no open report. Raw UPDATE so tours.updated_at does not move.
   */
  async dismissIf(tourId, { adminId, reason = null }) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw(Prisma.sql`
        UPDATE ${this.toursTable}
           SET open_report_count = 0, report_flagged_at = NULL
         WHERE id = ${tourId} AND open_report_count > 0
     RETURNING status`);
      if (!rows.length) return null;
      const { count: reportCount } = await tx.tourReport.updateMany({
        where: { tourId, status: REPORT_STATUS.OPEN },
        data: { status: REPORT_STATUS.DISMISSED },
      });
      const data = { status: rows[0].status, reportCount };
      await this.actionLog.append(
        { adminId, action: ADMIN_ACTION.DISMISS_REPORTS, targetType: ADMIN_TARGET.TOUR, targetId: tourId, reason, data },
        { tx },
      );
      return data;
    });
  }
}
