// In-memory stand-in for PrismaInAppNotificationRepository (same semantics: unique sourceKey,
// newest first, conditional mark read scoped to the user).
import { randomUUID } from 'node:crypto';

export class MemoryNotificationRepository {
  constructor({ clock = () => new Date() } = {}) {
    this.rows = [];
    this.clock = clock;
    this.failNext = null;
  }

  async createIfAbsent(row) {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    if (this.rows.some((r) => r.sourceKey === row.sourceKey)) return false;
    this.rows.push({ id: randomUUID(), readAt: null, createdAt: this.clock(), ...row });
    return true;
  }

  mine(userId, unreadOnly, tourId) {
    return this.rows.filter((r) => r.userId === userId && (!unreadOnly || !r.readAt) && (!tourId || r.tourId === tourId));
  }

  async list(userId, { unreadOnly = false, tourId, skip = 0, take = 20 } = {}) {
    return this.mine(userId, unreadOnly, tourId)
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
      .slice(skip, skip + take);
  }

  async count(userId, { unreadOnly = false, tourId } = {}) {
    return this.mine(userId, unreadOnly, tourId).length;
  }

  async markRead(userId, id, now) {
    const row = this.rows.find((r) => r.id === id && r.userId === userId);
    if (!row) return 'not_found';
    if (row.readAt) return 'already_read';
    row.readAt = now;
    return 'updated';
  }

  async markAllRead(userId, now) {
    const rows = this.mine(userId, true);
    for (const r of rows) r.readAt = now;
    return rows.length;
  }
}
