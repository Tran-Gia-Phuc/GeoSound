// =========================================================
// UC18 — Prisma implementation of the FollowRepository port (table auth.author_follows).
// Follow is "insert ... on conflict do nothing" (createMany skipDuplicates) on the unique
// (follower_id, author_id) pair, so concurrent follows of the same pair leave one row.
// =========================================================
import { PrismaUserRepository } from './prisma-user-repository.js';

/** Prisma filter: an author that has a public page (active contributor; ended suspension = active). */
export function followableAuthorWhere(now) {
  return {
    role: 'contributor',
    OR: [{ status: 'active' }, { status: 'suspended', suspendedUntil: { lte: now } }],
  };
}

/** @implements {import('../../domain/ports/index.js').FollowRepository} */
export class PrismaFollowRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  async follow(followerId, authorId) {
    await this.prisma.authorFollow.createMany({ data: [{ followerId, authorId }], skipDuplicates: true });
  }

  async unfollow(followerId, authorId) {
    await this.prisma.authorFollow.deleteMany({ where: { followerId, authorId } });
  }

  async isFollowing(followerId, authorId) {
    const row = await this.prisma.authorFollow.findUnique({
      where: { followerId_authorId: { followerId, authorId } },
      select: { id: true },
    });
    return row !== null;
  }

  async countFollowers(authorId) {
    return this.prisma.authorFollow.count({ where: { authorId } });
  }

  /** Authors I follow that still have a public page, newest follow first. */
  async listFollowing({ followerId, skip, take, now }) {
    const where = { followerId, author: followableAuthorWhere(now) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.authorFollow.findMany({
        where,
        include: { author: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.authorFollow.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({ author: PrismaUserRepository.toEntity(r.author), followedAt: r.createdAt })),
      total,
    };
  }

  /** Follower counts of several authors in one query (Map authorId -> count, missing = 0). */
  async countFollowersMany(authorIds) {
    const counts = new Map(authorIds.map((id) => [id, 0]));
    if (!authorIds.length) return counts;
    const rows = await this.prisma.authorFollow.groupBy({
      by: ['authorId'],
      where: { authorId: { in: authorIds } },
      _count: { _all: true },
    });
    for (const r of rows) counts.set(r.authorId, r._count._all);
    return counts;
  }
}
