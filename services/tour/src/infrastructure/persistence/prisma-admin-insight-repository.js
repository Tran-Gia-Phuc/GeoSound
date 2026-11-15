// =========================================================
// UC22 (#275) — impl of AdminInsightRepository with Prisma: read-only numbers of the admin dashboard
// and the UC21 violation history of one author (tables tours, tour_reports, tour_review_actions,
// admin_actions). Nothing here writes.
// Raw SQL names its tables with the schema of DATABASE_URL (?schema=tour). Period bounds are passed as
// ISO strings and turned into UTC timestamps in SQL, because the columns are `timestamp(3)` without a
// time zone holding UTC values (Prisma default): the comparison never depends on the session TimeZone.
// =========================================================
import { Prisma } from '@prisma/client';
import { TOUR_STATUS, REVIEWABLE_STATUSES } from '../../domain/entities/tour.js';
import { ADMIN_ACTION, ADMIN_TARGET, REVIEW_DECISION_ACTIONS } from '../../domain/entities/admin-action.js';
import { REVIEW_ACTION } from '../../domain/entities/tour-review-action.js';
import { TOP_CONTRIBUTOR_LIMIT, TOP_CONTRIBUTOR_MIN_RATING } from '../../domain/tour/admin-insights.js';
import { schemaFromUrl, SQL_IDENTIFIER } from './schema-name.js';

const utc = (date) => Prisma.sql`(CAST(${date.toISOString()} AS timestamptz) AT TIME ZONE 'UTC')`;

/** @implements {import('../../domain/ports/index.js').AdminInsightRepository} */
export class PrismaAdminInsightRepository {
  /**
   * @param {import('@prisma/client').PrismaClient} prisma
   * @param {{ schema?: string }} [opts]
   */
  constructor(prisma, { schema = schemaFromUrl(process.env.DATABASE_URL) } = {}) {
    if (!SQL_IDENTIFIER.test(schema)) throw new Error(`invalid schema name: ${schema}`);
    this.prisma = prisma;
    this.toursTable = Prisma.raw(`"${schema}"."tours"`);
    this.reportsTable = Prisma.raw(`"${schema}"."tour_reports"`);
    this.actionsTable = Prisma.raw(`"${schema}"."admin_actions"`);
  }

  // ---------- dashboard ----------

  /** Tours waiting for an admin now (snapshot, not filtered by the period). */
  async countReviewQueue() {
    const grouped = await this.prisma.tour.groupBy({
      by: ['status'],
      where: { status: { in: [...REVIEWABLE_STATUSES] } },
      _count: { _all: true },
    });
    const counts = { [TOUR_STATUS.PENDING_REVIEW]: 0, [TOUR_STATUS.AI_WARNING]: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    return counts;
  }

  /** Mean of (decision time - data.queuedAt) in seconds over the UC19 decisions of the period; null if none. */
  async averageReviewSeconds({ from, to }) {
    const [row] = await this.prisma.$queryRaw(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM (a.created_at - ((a.data->>'queuedAt')::timestamptz AT TIME ZONE 'UTC'))))::float8
             AS "seconds"
        FROM ${this.actionsTable} a
       WHERE a.action IN (${Prisma.join([...REVIEW_DECISION_ACTIONS])})
         AND a.created_at >= ${utc(from)} AND a.created_at < ${utc(to)}
         AND a.data ? 'queuedAt'
         AND a.created_at >= ((a.data->>'queuedAt')::timestamptz AT TIME ZONE 'UTC')`);
    return row?.seconds === null || row?.seconds === undefined ? null : Number(row.seconds);
  }

  /** Distinct tours with at least one report created in the period (any report status). */
  async countReportedTours({ from, to }) {
    const [row] = await this.prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(DISTINCT r.tour_id)::int AS "count"
        FROM ${this.reportsTable} r
       WHERE r.created_at >= ${utc(from)} AND r.created_at < ${utc(to)}`);
    return Number(row?.count ?? 0);
  }

  /** Tours with open reports now (the UC20 queue size). */
  async countOpenReportTours() {
    return this.prisma.tour.count({ where: { openReportCount: { gt: 0 } } });
  }

  /**
   * Decision L14: authors with the most public tours rated >= 4 on average, without any hide_tour
   * action on one of their tours within the period. averageRating = mean over the qualifying tours.
   */
  async topContributors({ from, to }, { limit = TOP_CONTRIBUTOR_LIMIT } = {}) {
    const rows = await this.prisma.$queryRaw(Prisma.sql`
      SELECT t.author_id AS "authorId", COUNT(*)::int AS "publicTours", AVG(t.average_rating)::float8 AS "averageRating"
        FROM ${this.toursTable} t
       WHERE t.status = ${TOUR_STATUS.PUBLIC}
         AND t.rating_count > 0
         AND t.average_rating >= ${TOP_CONTRIBUTOR_MIN_RATING}
         AND NOT EXISTS (
               SELECT 1
                 FROM ${this.actionsTable} a
                 JOIN ${this.toursTable} h ON h.id = a.target_id
                WHERE a.action = ${ADMIN_ACTION.HIDE_TOUR}
                  AND a.target_type = ${ADMIN_TARGET.TOUR}
                  AND h.author_id = t.author_id
                  AND a.created_at >= ${utc(from)} AND a.created_at < ${utc(to)})
       GROUP BY t.author_id
       ORDER BY "publicTours" DESC, "averageRating" DESC, t.author_id ASC
       LIMIT ${limit}`);
    return rows.map((r) => ({
      authorId: r.authorId,
      publicTours: Number(r.publicTours),
      averageRating: Number(r.averageRating),
    }));
  }

  /** Log rows of the period by action. */
  async countActionsByType({ from, to }) {
    const grouped = await this.prisma.adminAction.groupBy({
      by: ['action'],
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
    const counts = {};
    for (const g of grouped) counts[g.action] = g._count._all;
    return counts;
  }

  // ---------- UC21 violation history (one author) ----------

  /** Tours of the author by status. */
  async countToursByStatus(authorId) {
    const grouped = await this.prisma.tour.groupBy({ by: ['status'], where: { authorId }, _count: { _all: true } });
    const counts = {};
    for (const g of grouped) counts[g.status] = g._count._all;
    return counts;
  }

  /**
   * Hidden tours of the author with the time of their last hide (admin_actions), newest first.
   * @returns {Promise<Array<{ id, title, hiddenAt: Date|null, reason: string|null }>>}
   */
  async listHiddenTours(authorId, { limit }) {
    const tours = await this.prisma.tour.findMany({
      where: { authorId, status: TOUR_STATUS.HIDDEN },
      select: { id: true, title: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    const last = await this.lastActions(tours.map((t) => t.id), ADMIN_ACTION.HIDE_TOUR);
    return tours.map((t) => ({
      id: t.id,
      title: t.title,
      hiddenAt: last.get(t.id)?.createdAt ?? null,
      reason: last.get(t.id)?.reason ?? null,
    }));
  }

  /**
   * Rejected tours of the author with the time of the UC19 rejection (tour_review_actions also holds the
   * decisions taken before the shared log existed), newest first.
   * @returns {Promise<Array<{ id, title, rejectedAt: Date|null, reason: string|null }>>}
   */
  async listRejectedTours(authorId, { limit }) {
    const tours = await this.prisma.tour.findMany({
      where: { authorId, status: TOUR_STATUS.REJECTED },
      select: { id: true, title: true, reviewReason: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    const ids = tours.map((t) => t.id);
    const grouped = ids.length
      ? await this.prisma.tourReviewAction.groupBy({
          by: ['tourId'],
          where: { tourId: { in: ids }, action: REVIEW_ACTION.REJECT },
          _max: { createdAt: true },
        })
      : [];
    const at = new Map(grouped.map((g) => [g.tourId, g._max.createdAt]));
    return tours.map((t) => ({ id: t.id, title: t.title, rejectedAt: at.get(t.id) ?? null, reason: t.reviewReason ?? null }));
  }

  /** Reports received on the author's tours, by status. */
  async countReportsOnAuthorTours(authorId) {
    const grouped = await this.prisma.tourReport.groupBy({
      by: ['status'],
      where: { tour: { authorId } },
      _count: { _all: true },
    });
    const counts = {};
    for (const g of grouped) counts[g.status] = g._count._all;
    return counts;
  }

  /** Latest row of `action` for each tour id -> Map(tourId -> { createdAt, reason }). */
  async lastActions(tourIds, action) {
    if (!tourIds.length) return new Map();
    const rows = await this.prisma.adminAction.findMany({
      where: { targetType: ADMIN_TARGET.TOUR, targetId: { in: tourIds }, action },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { targetId: true, createdAt: true, reason: true },
    });
    const last = new Map();
    for (const r of rows) if (!last.has(r.targetId)) last.set(r.targetId, r);
    return last;
  }
}
