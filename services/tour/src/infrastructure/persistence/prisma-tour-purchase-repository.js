// =========================================================
// UC25 (#446) — tour_purchases (one row per MoMo order, id = orderId). Status writes are conditional
// UPDATEs: paid from pending or failed (a late MoMo success still counts), failed only from pending.
// =========================================================
import { PURCHASE_STATUS } from '../../domain/tour/tour-price.js';

const { PENDING, PAID, FAILED } = PURCHASE_STATUS;

export class PrismaTourPurchaseRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  async create({ tourId, userId, amount }) {
    return this.prisma.tourPurchase.create({ data: { tourId, userId, amount } });
  }

  async findById(id) {
    return this.prisma.tourPurchase.findUnique({ where: { id } });
  }

  async hasPaid(tourId, userId) {
    return (await this.prisma.tourPurchase.count({ where: { tourId, userId, status: PAID } })) > 0;
  }

  /** Ids of the given tours that are paid, not written by userId and not bought by userId. */
  async lockedTourIds(userId, tourIds) {
    if (!tourIds.length) return [];
    const paid = await this.prisma.tour.findMany({
      where: { id: { in: tourIds }, price: { gt: 0 }, authorId: { not: userId } },
      select: { id: true },
    });
    if (!paid.length) return [];
    const bought = await this.prisma.tourPurchase.findMany({
      where: { userId, status: PAID, tourId: { in: paid.map((t) => t.id) } },
      select: { tourId: true },
    });
    const own = new Set(bought.map((b) => b.tourId));
    return paid.map((t) => t.id).filter((id) => !own.has(id));
  }

  /** @returns {Promise<number>} rows updated (0 | 1) */
  async markPaidIf(id, { transId, resultCode, paidAt }) {
    const { count } = await this.prisma.tourPurchase.updateMany({
      where: { id, status: { in: [PENDING, FAILED] } },
      data: { status: PAID, transId, resultCode, paidAt },
    });
    return count;
  }

  async markFailedIf(id, { resultCode }) {
    const { count } = await this.prisma.tourPurchase.updateMany({
      where: { id, status: PENDING },
      data: { status: FAILED, resultCode },
    });
    return count;
  }

  /** Studio: copies sold and revenue (VND) of a tour. */
  async salesOf(tourId) {
    const r = await this.prisma.tourPurchase.aggregate({
      where: { tourId, status: PAID },
      _count: { _all: true },
      _sum: { amount: true },
    });
    return { paidCount: r._count._all, revenue: r._sum.amount ?? 0 };
  }

  /** Purchase history of one account, newest first, with the tour title (null if the tour is gone). */
  async listByUser(userId, limit) {
    return this.#withTitles(await this.prisma.tourPurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit }));
  }

  /** Admin: every order (optional status filter), newest first, one page, plus paid totals of all time. */
  async listAll({ status, page, limit }) {
    const where = status ? { status } : {};
    const [rows, total, sales] = await Promise.all([
      this.prisma.tourPurchase.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.tourPurchase.count({ where }),
      this.prisma.tourPurchase.aggregate({ where: { status: PAID }, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    return { rows: await this.#withTitles(rows), total, paidCount: sales._count._all, revenue: sales._sum.amount ?? 0 };
  }

  // tour_id is a soft ref: the title is null once the tour is deleted.
  async #withTitles(rows) {
    const tourIds = [...new Set(rows.map((r) => r.tourId))];
    const tours = tourIds.length
      ? await this.prisma.tour.findMany({ where: { id: { in: tourIds } }, select: { id: true, title: true } })
      : [];
    const titles = new Map(tours.map((t) => [t.id, t.title]));
    return rows.map((r) => ({ ...r, tourTitle: titles.get(r.tourId) ?? null }));
  }

  /** Studio: paid orders of a tour, newest first. */
  async paidOfTour(tourId, limit) {
    return this.prisma.tourPurchase.findMany({ where: { tourId, status: PAID }, orderBy: { paidAt: 'desc' }, take: limit });
  }
}
