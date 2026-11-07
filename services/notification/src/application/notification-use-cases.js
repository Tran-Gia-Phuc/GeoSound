// =========================================================
// UC16 (#270) — read side of in-app notifications. Every use case is scoped to one user id taken
// from the access token: a user only ever reads or marks their own notifications.
// Repository port (Prisma in infrastructure, in-memory in tests):
//   list(userId, { unreadOnly, tourId, skip, take }) -> rows newest first
//   count(userId, { unreadOnly, tourId }) -> number
// tourId (#297) is optional and narrows the list and its total to one tour; `unread` stays global.
//   markRead(userId, id, now) -> 'updated' | 'already_read' | 'not_found'
//   markAllRead(userId, now) -> number of rows changed
// =========================================================

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export class NotificationNotFoundError extends Error {
  constructor() {
    super('Không tìm thấy thông báo');
    this.status = 404;
    this.code = 'notification_not_found';
  }
}

/** Public shape of one notification (never the recipient id or the idempotency key). */
export function toView(row) {
  return {
    id: row.id,
    type: row.type,
    tourId: row.tourId ?? null,
    title: row.title,
    body: row.body ?? null,
    data: row.data ?? {},
    read: Boolean(row.readAt),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

export class ListNotifications {
  constructor({ repository }) {
    this.repository = repository;
  }

  async execute({ userId, page = 1, limit = DEFAULT_LIMIT, unreadOnly = false, tourId }) {
    const take = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const skip = (Math.max(page, 1) - 1) * take;
    const [rows, total, unread] = await Promise.all([
      this.repository.list(userId, { unreadOnly, tourId, skip, take }),
      this.repository.count(userId, { unreadOnly, tourId }),
      // The badge count is global (all tours), whatever the list filter.
      this.repository.count(userId, { unreadOnly: true }),
    ]);
    return { items: rows.map(toView), page, limit: take, total, unread };
  }
}

export class CountUnread {
  constructor({ repository }) {
    this.repository = repository;
  }

  async execute({ userId }) {
    return { unread: await this.repository.count(userId, { unreadOnly: true }) };
  }
}

export class MarkRead {
  constructor({ repository, now = () => new Date() }) {
    this.repository = repository;
    this.now = now;
  }

  /** Marking an already read notification again is fine (idempotent); another user's id is 404. */
  async execute({ userId, id }) {
    const result = await this.repository.markRead(userId, id, this.now());
    if (result === 'not_found') throw new NotificationNotFoundError();
  }
}

export class MarkAllRead {
  constructor({ repository, now = () => new Date() }) {
    this.repository = repository;
    this.now = now;
  }

  async execute({ userId }) {
    return { updated: await this.repository.markAllRead(userId, this.now()) };
  }
}
