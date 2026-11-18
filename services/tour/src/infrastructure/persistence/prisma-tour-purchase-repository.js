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
}
