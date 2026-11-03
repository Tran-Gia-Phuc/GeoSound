// =========================================================
// UC16 (#270) — thin HTTP controller: validates input with zod, takes the user id from the access
// token (req.user.sub, set by verifyJwt) and calls the use cases. Errors carry status + code +
// a Vietnamese message; the service error handler writes them.
// =========================================================
import { z } from 'zod';
import { DEFAULT_LIMIT, MAX_LIMIT, NotificationNotFoundError } from '../../application/notification-use-cases.js';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  unread: z.enum(['true', 'false']).optional(),
});

const idParam = z.string().uuid();

function validationError(details) {
  const err = new Error('Tham số không hợp lệ');
  err.status = 400;
  err.code = 'validation_error';
  err.details = details;
  return err;
}

function unauthenticated() {
  const err = new Error('Vui lòng đăng nhập');
  err.status = 401;
  err.code = 'unauthenticated';
  return err;
}

function userIdOf(req) {
  const sub = req.user?.sub;
  if (typeof sub !== 'string' || !sub) throw unauthenticated();
  return sub;
}

export class NotificationController {
  /** @param {{ listNotifications, countUnread, markRead, markAllRead }} useCases */
  constructor({ listNotifications, countUnread, markRead, markAllRead }) {
    this.listNotifications = listNotifications;
    this.countUnread = countUnread;
    this.markRead = markRead;
    this.markAllRead = markAllRead;
  }

  list = async (req, res) => {
    const userId = userIdOf(req);
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const { page, limit, unread } = parsed.data;
    res.json(await this.listNotifications.execute({ userId, page, limit, unreadOnly: unread === 'true' }));
  };

  unreadCount = async (req, res) => {
    res.json(await this.countUnread.execute({ userId: userIdOf(req) }));
  };

  read = async (req, res) => {
    const userId = userIdOf(req);
    // A malformed id can never be one of the user's notifications: same 404 as an unknown id.
    if (!idParam.safeParse(req.params.id).success) throw new NotificationNotFoundError();
    await this.markRead.execute({ userId, id: req.params.id });
    res.status(204).end();
  };

  readAll = async (req, res) => {
    res.json(await this.markAllRead.execute({ userId: userIdOf(req) }));
  };
}
