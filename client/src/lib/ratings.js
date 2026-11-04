// =========================================================
// Tour ratings (UC05, #267) over the gateway /api/tours/:id/ratings.
// Reading is public; my rating needs a signed-in account (any role).
// =========================================================
import { api } from './api.js';

export const RATING_COMMENT_MAX = 1000;
export const RATINGS_PAGE_SIZE = 10;

const base = (tourId) => `/api/tours/${encodeURIComponent(tourId)}/ratings`;

/**
 * GET /:id/ratings?page&limit (public, newest first) ->
 * { summary: { averageRating, ratingCount, distribution: {1..5: n} },
 *   items: [{ id, userName, stars, comment, createdAt, updatedAt }], page, limit, total }
 */
export function listRatings(tourId, { page = 1, limit = RATINGS_PAGE_SIZE } = {}, opts) {
  const q = new URLSearchParams({ page: String(page), limit: String(limit) });
  return api.get(`${base(tourId)}?${q.toString()}`, opts);
}

/** GET /:id/ratings/mine -> my rating or null. */
export async function getMyRating(tourId, opts) {
  const body = await api.get(`${base(tourId)}/mine`, { ...opts, auth: true });
  return body?.rating ?? null;
}

/**
 * PUT /:id/ratings/mine { stars, comment } -> 201 created | 200 updated:
 * { rating, summary: { averageRating, ratingCount } }
 */
export function saveMyRating(tourId, { stars, comment }) {
  const text = (comment ?? '').trim();
  return api.put(`${base(tourId)}/mine`, { stars, comment: text || null }, { auth: true });
}

/** DELETE /:id/ratings/mine -> 204 (404 rating_not_found when there is none). */
export function deleteMyRating(tourId) {
  return api.del(`${base(tourId)}/mine`, { auth: true });
}
