// =========================================================
// In-app notifications (UC16) over the gateway /api/notifications.
// Every route needs a signed-in user; a user only sees their own notifications.
// =========================================================
import { api } from './api.js';

/**
 * GET /api/notifications?page=&limit=&unread=&tourId= ->
 * { items: [{ id, type, tourId, title, body, data, read, createdAt }], page, limit, total, unread }
 * Newest first; `total` follows the filters (`tourId` = one tour only, #297), `unread` is the
 * user's unread count over all tours.
 */
export function listNotifications({ page = 1, limit = 20, unread = false, tourId } = {}, opts) {
  const q = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (unread) q.set('unread', 'true');
  if (tourId) q.set('tourId', tourId);
  return api.get(`/api/notifications?${q}`, { ...opts, auth: true });
}

/** GET /api/notifications/unread-count -> number */
export async function getUnreadCount(opts) {
  const body = await api.get('/api/notifications/unread-count', { ...opts, auth: true });
  return Number(body?.unread) || 0;
}

/** POST /api/notifications/:id/read -> 204 (also when already read; 404 when unknown). */
export function markNotificationRead(id) {
  return api.post(`/api/notifications/${encodeURIComponent(id)}/read`, undefined, { auth: true });
}

/** POST /api/notifications/read-all -> number of notifications marked read. */
export async function markAllNotificationsRead() {
  const body = await api.post('/api/notifications/read-all', undefined, { auth: true });
  return Number(body?.updated) || 0;
}

/** Where a notification leads: tour events -> the Studio tour page, the rest -> the account page. */
export function notificationTarget(n) {
  return n?.tourId ? `/studio/tours/${encodeURIComponent(n.tourId)}` : '/account';
}
