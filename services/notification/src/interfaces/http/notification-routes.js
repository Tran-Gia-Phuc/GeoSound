// =========================================================
// UC16 (#270) — routes of /api/notifications (the gateway strips the prefix). Every route needs a
// signed-in user of any role: `requireAuth` = shared verifyJwt([]), injected by src/index.js so this
// file never imports ../shared (CI rule).
// =========================================================
import { Router } from 'express';

// Express 4 does not forward rejected promises: pass them to the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * @param {{ controller: import('./notification-controller.js').NotificationController,
 *           requireAuth: import('express').RequestHandler }} deps
 */
export function buildNotificationRouter({ controller, requireAuth }) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', wrap(controller.list));
  router.get('/unread-count', wrap(controller.unreadCount));
  // Declared before /:id/read so "read-all" is never taken for an id.
  router.post('/read-all', wrap(controller.readAll));
  router.post('/:id/read', wrap(controller.read));
  return router;
}
