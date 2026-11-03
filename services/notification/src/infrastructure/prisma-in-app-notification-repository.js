// =========================================================
// UC16 (#270) — Prisma repository of in_app_notifications (schema "notification").
// Writes are conditional (no read-then-write): insert with ON CONFLICT DO NOTHING on source_key,
// mark read only rows of this user that are still unread.
// =========================================================

export class PrismaInAppNotificationRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  /** @returns {Promise<boolean>} true when inserted, false when the sourceKey already exists. */
  async createIfAbsent(row) {
    const { count } = await this.prisma.inAppNotification.createMany({
      data: [{
        userId: row.userId,
        type: row.type,
        tourId: row.tourId ?? null,
        title: row.title,
        body: row.body ?? null,
        data: row.data ?? {},
        sourceKey: row.sourceKey,
      }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  where(userId, unreadOnly) {
    return unreadOnly ? { userId, readAt: null } : { userId };
  }

  list(userId, { unreadOnly = false, skip = 0, take = 20 } = {}) {
    return this.prisma.inAppNotification.findMany({
      where: this.where(userId, unreadOnly),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    });
  }

  count(userId, { unreadOnly = false } = {}) {
    return this.prisma.inAppNotification.count({ where: this.where(userId, unreadOnly) });
  }

  /** @returns {Promise<'updated'|'already_read'|'not_found'>} */
  async markRead(userId, id, now) {
    const { count } = await this.prisma.inAppNotification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: now },
    });
    if (count === 1) return 'updated';
    const own = await this.prisma.inAppNotification.count({ where: { id, userId } });
    return own ? 'already_read' : 'not_found';
  }

  async markAllRead(userId, now) {
    const { count } = await this.prisma.inAppNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });
    return count;
  }
}
