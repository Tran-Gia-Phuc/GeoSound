// =========================================================
// UC17 (#271) — impl of TourStatsRepository with Prisma (tables tour_daily_stats, tour_activity_marks).
// recordActivity is ONE SQL statement (so one transaction): insert the dedup mark with
// ON CONFLICT DO NOTHING (and only while the actor is under the daily cap), then upsert the daily
// counter from the RETURNING row of that insert. A repeated or capped action inserts no mark, so it
// counts nothing. Concurrent identical requests wait on the mark's primary key and then skip.
// Nothing here touches the tours table (tours.updated_at never moves).
// =========================================================
import { Prisma } from '@prisma/client';
import { schemaFromUrl, SQL_IDENTIFIER } from './schema-name.js';

const asDate = (day) => new Date(`${day}T00:00:00Z`);
const asDay = (date) => new Date(date).toISOString().slice(0, 10);

/** @implements {import('../../domain/ports/index.js').TourStatsRepository} */
export class PrismaTourStatsRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma @param {{ schema?: string }} [opts] */
  constructor(prisma, { schema = schemaFromUrl(process.env.DATABASE_URL) } = {}) {
    if (!SQL_IDENTIFIER.test(schema)) throw new Error(`invalid schema name: ${schema}`);
    this.prisma = prisma;
    this.dailyTable = Prisma.raw(`"${schema}"."tour_daily_stats"`);
    this.marksTable = Prisma.raw(`"${schema}"."tour_activity_marks"`);
  }

  /**
   * @param {{ tourId: string, actorKey: string, action: string, language: string, day: string, cap: number }} input
   * @returns {Promise<boolean>} true when this call counted
   */
  async recordActivity({ tourId, actorKey, action, language, day, cap }) {
    const rows = await this.prisma.$queryRaw(Prisma.sql`
      WITH mark AS (
        INSERT INTO ${this.marksTable} (tour_id, actor_key, action, language, day)
        SELECT ${tourId}, ${actorKey}, ${action}, ${language}, ${day}::date
         WHERE (SELECT count(*) FROM ${this.marksTable}
                 WHERE actor_key = ${actorKey} AND day = ${day}::date) < ${cap}::int
        ON CONFLICT DO NOTHING
        RETURNING action
      )
      INSERT INTO ${this.dailyTable} AS d (tour_id, day, language, views, plays, completions, downloads)
      SELECT ${tourId}, ${day}::date, ${language},
             (action = 'view')::int, (action = 'play')::int, (action = 'complete')::int, (action = 'download')::int
        FROM mark
      ON CONFLICT (tour_id, day, language) DO UPDATE
         SET views       = d.views + EXCLUDED.views,
             plays       = d.plays + EXCLUDED.plays,
             completions = d.completions + EXCLUDED.completions,
             downloads   = d.downloads + EXCLUDED.downloads
      RETURNING 1 AS counted`);
    return rows.length > 0;
  }

  /** Days with data in [from, to], summed over languages unless one is given, oldest first. */
  async dailyStats(tourId, { from, to, language }) {
    const groups = await this.prisma.tourDailyStat.groupBy({
      by: ['day'],
      where: { tourId, day: { gte: asDate(from), lte: asDate(to) }, ...(language ? { language } : {}) },
      _sum: { views: true, plays: true, completions: true, downloads: true },
      orderBy: { day: 'asc' },
    });
    return groups.map((g) => ({
      day: asDay(g.day),
      views: g._sum.views ?? 0,
      plays: g._sum.plays ?? 0,
      completions: g._sum.completions ?? 0,
      downloads: g._sum.downloads ?? 0,
    }));
  }

  /** Latest ratings that carry a comment (UC05 rows), and how many there are. */
  async latestComments(tourId, { take }) {
    const where = { tourId, comment: { not: null } };
    const [rows, total] = await Promise.all([
      this.prisma.tourRating.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take }),
      this.prisma.tourRating.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({ id: r.id, userName: r.userName, stars: r.stars, comment: r.comment, createdAt: r.createdAt })),
      total,
    };
  }

  /** Delete dedup marks of days before `day` (exclusive). */
  async purgeMarksBefore(day) {
    const { count } = await this.prisma.tourActivityMark.deleteMany({ where: { day: { lt: asDate(day) } } });
    return count;
  }
}
