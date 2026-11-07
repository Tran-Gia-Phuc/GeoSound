// =========================================================
// Tour statistics (UC17, #271).
//   - recordTourActivity: fire-and-forget beacon POST /api/tours/:id/activity
//     { action: view|play|complete|download, language?, deviceId } (optional auth). Never throws,
//     never blocks the screen; the server answers 204 and dedups per actor and UTC day.
//   - getTourStats: GET /api/tours/mine/:id/stats?from&to&language (author or admin).
// =========================================================
import { api } from './api.js';
import { getDeviceId } from './device-id.js';

export const TOUR_ACTIONS = ['view', 'play', 'complete', 'download'];

/**
 * @param {string} tourId
 * @param {'view'|'play'|'complete'|'download'} action
 * @param {{ language?: string, authenticated?: boolean }} [opts]
 */
export function recordTourActivity(tourId, action, { language, authenticated = false } = {}) {
  if (!tourId || !TOUR_ACTIONS.includes(action)) return;
  const body = { action, deviceId: getDeviceId() };
  if (language) body.language = language;
  try {
    api.post(`/api/tours/${encodeURIComponent(tourId)}/activity`, body, { auth: authenticated }).catch(() => {});
  } catch {
    /* statistics must never break the screen */
  }
}

/**
 * -> { tourId, from, to, language, totals: { views, plays, completions, downloads, completionRate },
 *      daily: [{ day, views, plays, completions, downloads }], ratings: { averageRating, ratingCount,
 *      distribution }, comments: { items: [{ id, userName, stars, comment, createdAt }], total } }
 */
export function getTourStats(tourId, { from, to, language } = {}, opts) {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (language) q.set('language', language);
  const qs = q.toString();
  return api.get(`/api/tours/mine/${encodeURIComponent(tourId)}/stats${qs ? `?${qs}` : ''}`, { ...opts, auth: true });
}
