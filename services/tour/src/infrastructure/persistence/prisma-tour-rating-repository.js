// =========================================================
// UC05 (#267) — impl of TourRatingRepository with Prisma (table tour_ratings).
// A write runs in one transaction: lock the caller's rating row (SELECT ... FOR UPDATE), write it,
// then move the tour aggregate with one raw UPDATE (design R7). The locks serialise concurrent
// submits of one account and concurrent ratings of one tour, so no retry loop is needed. The raw
// UPDATE keeps the seeded values as a starting point and does not touch tours.updated_at
// (moderation / catalog revision), which a Prisma `update` would bump through @updatedAt.
// =========================================================
import { Prisma } from '@prisma/client';
import { TourRating, ratingDelta } from '../../domain/entities/tour-rating.js';
import { schemaFromUrl, SQL_IDENTIFIER } from './schema-name.js';

const toEntity = (row) => (row ? new TourRating(row) : null);
const toSummary = (row) => ({ averageRating: Number(row?.averageRating ?? 0), ratingCount: Number(row?.ratingCount ?? 0) });

/** @implements {import('../../domain/ports/index.js').TourRatingRepository} */
export class PrismaTourRatingRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma @param {{ schema?: string }} [opts] */
  constructor(prisma, { schema = schemaFromUrl(process.env.DATABASE_URL) } = {}) {
    if (!SQL_IDENTIFIER.test(schema)) throw new Error(`invalid schema name: ${schema}`);
    this.prisma = prisma;
    this.toursTable = Prisma.raw(`"${schema}"."tours"`);
    this.ratingsTable = Prisma.raw(`"${schema}"."tour_ratings"`);
  }

  async #lockOwn(tx, tourId, userId) {
    const rows = await tx.$queryRaw(Prisma.sql`
      SELECT id, stars FROM ${this.ratingsTable}
       WHERE tour_id = ${tourId} AND user_id = ${userId}
         FOR UPDATE`);
    return rows[0] ?? null;
  }

  // R7 — one statement: new average from the old average and count (SET sees the old row).
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

  async findByTourAndUser(tourId, userId) {
    return toEntity(await this.prisma.tourRating.findUnique({ where: { tourId_userId: { tourId, userId } } }));
  }

  async saveForUser({ tourId, userId, userName, stars, comment }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const own = await this.#lockOwn(tx, tourId, userId);
        if (own) {
          const row = await tx.tourRating.update({ where: { id: own.id }, data: { stars, comment, userName } });
          const summary = await this.#moveAggregate(tx, tourId, ratingDelta.updated(own.stars, stars));
          return { created: false, rating: toEntity(row), summary };
        }
        const row = await tx.tourRating.create({ data: { tourId, userId, userName, stars, comment } });
        const summary = await this.#moveAggregate(tx, tourId, ratingDelta.created(stars));
        return { created: true, rating: toEntity(row), summary };
      });
    } catch (err) {
      // A concurrent first submit of the same account inserted the row (unique tour + user).
      if (err?.code === 'P2002') return null;
      throw err;
    }
  }

  async deleteForUser(tourId, userId) {
    return this.prisma.$transaction(async (tx) => {
      const own = await this.#lockOwn(tx, tourId, userId);
      if (!own) return null;
      await tx.tourRating.delete({ where: { id: own.id } });
      return { summary: await this.#moveAggregate(tx, tourId, ratingDelta.deleted(own.stars)) };
    });
  }

  async listByTour(tourId, { skip, take }) {
    const [rows, total] = await Promise.all([
      this.prisma.tourRating.findMany({ where: { tourId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take }),
      this.prisma.tourRating.count({ where: { tourId } }),
    ]);
    return { items: rows.map(toEntity), total };
  }

  async distribution(tourId) {
    const groups = await this.prisma.tourRating.groupBy({ by: ['stars'], where: { tourId }, _count: { _all: true } });
    const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const g of groups) if (out[g.stars] !== undefined) out[g.stars] = g._count._all;
    return out;
  }
}
