// =========================================================
// UC14 (#269) — TourAccessRepository with Prisma (docs/02-design/uc14-restricted-access.md).
//   - status writes are conditional (one UPDATE ... WHERE id AND status IN ...) and delete the grants
//     in the same transaction; they bump tours.updated_at like any status change
//   - grants (tour_access_grants) and attempts (tour_unlock_attempts) live in their own tables, so
//     unlock bookkeeping never moves tours.updated_at (moderation / catalog revision)
// =========================================================
import { PrismaTourRepository } from './prisma-tour-repository.js';

/** @implements {import('../../domain/ports/index.js').TourAccessRepository} */
export class PrismaTourAccessRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  async findAccess(tourId) {
    const row = await this.prisma.tour.findUnique({
      where: { id: tourId },
      select: { id: true, authorId: true, status: true, passcodeHash: true, passcodeVersion: true, passcodeSetAt: true },
    });
    if (!row) return null;
    const { id, ...rest } = row;
    return { tourId: id, ...rest };
  }

  async setPasscodeIf(tourId, fromStatuses, { passcodeHash, passcodeSetAt }) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.tour.updateMany({
        where: { id: tourId, status: { in: [...fromStatuses] } },
        data: { status: 'restricted', passcodeHash, passcodeSetAt, passcodeVersion: { increment: 1 } },
      });
      if (!count) return null;
      await tx.tourAccessGrant.deleteMany({ where: { tourId } });
      return PrismaTourRepository.toEntity(await tx.tour.findUnique({ where: { id: tourId } }));
    });
  }

  async clearPasscodeIf(tourId) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.tour.updateMany({
        where: { id: tourId, status: 'restricted' },
        data: { status: 'draft', passcodeHash: null, passcodeSetAt: null, passcodeVersion: { increment: 1 } },
      });
      if (!count) return null;
      await tx.tourAccessGrant.deleteMany({ where: { tourId } });
      await tx.tourUnlockAttempt.deleteMany({ where: { tourId } });
      return PrismaTourRepository.toEntity(await tx.tour.findUnique({ where: { id: tourId } }));
    });
  }

  async findGrant(tourId, userId) {
    return this.prisma.tourAccessGrant.findUnique({ where: { tourId_userId: { tourId, userId } } });
  }

  async saveGrant(tourId, userId, passcodeVersion) {
    await this.prisma.tourAccessGrant.upsert({
      where: { tourId_userId: { tourId, userId } },
      create: { tourId, userId, passcodeVersion },
      update: { passcodeVersion, createdAt: new Date() },
    });
  }

  async countGrants(tourId, passcodeVersion) {
    return this.prisma.tourAccessGrant.count({ where: { tourId, passcodeVersion } });
  }

  // Insert first, count after: each insert commits on its own, so concurrent requests of one account
  // always count each other (at most UNLOCK_MAX_FAILURES checks can run in one window).
  async reserveAttempt(tourId, userId, since) {
    const row = await this.prisma.tourUnlockAttempt.create({ data: { tourId, userId, createdAt: new Date() } });
    const count = await this.prisma.tourUnlockAttempt.count({
      where: { tourId, userId, createdAt: { gte: since } },
    });
    return { id: row.id, count };
  }

  async releaseAttempt(id) {
    await this.prisma.tourUnlockAttempt.deleteMany({ where: { id } });
  }
}
