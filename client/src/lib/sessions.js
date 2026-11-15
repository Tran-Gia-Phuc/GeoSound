// =========================================================
// Signed-in devices (UC23) over the gateway /api/auth/sessions.
// =========================================================
import { api } from './api.js';

/** GET /api/auth/sessions -> [{ id, deviceName, location, createdAt, lastActiveAt, current }] */
export async function listSessions(opts) {
  const body = await api.get('/api/auth/sessions', { ...opts, auth: true });
  return body?.sessions ?? [];
}

/** DELETE /api/auth/sessions/:id -> 204 (404 when already signed out). */
export function revokeSession(id) {
  return api.del(`/api/auth/sessions/${encodeURIComponent(id)}`, { auth: true });
}

/** POST /api/auth/sessions/revoke-others -> number of revoked sessions. */
export async function revokeOtherSessions() {
  const body = await api.post('/api/auth/sessions/revoke-others', undefined, { auth: true });
  return body?.revoked ?? 0;
}

/**
 * #265 — GET /api/auth/admin/sessions (admin only) ->
 * { at, onlineWindowSeconds,
 *   totals: { devicesSeen, signedIn, online, onlineAccounts,
 *             onlineDevices, onlineGuests, activeToday, active7Days, active30Days },  // #329, null without Redis
 *   online: [{ id, deviceName, location, createdAt, lastActiveAt, user: { id, email, fullName, role } }] }
 * The "online" beat of this browser lives in lib/presence.js (#329).
 */
export function getOnlineDevices(opts) {
  return api.get('/api/auth/admin/sessions', { ...opts, auth: true });
}
