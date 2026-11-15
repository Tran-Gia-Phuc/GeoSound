// =========================================================
// Route CÔNG KHAI "Khám phá địa điểm lẻ" (UC07 bước 1-2) — KHÔNG verifyJwt.
// Qua gateway: /api/places -> ở đây là /places (xem index.js).
// =========================================================
import { Router } from 'express';
import { validateQuery } from '../middleware/validate.js';
import { exploreQuerySchema } from '../../../application/dtos/itinerary-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ exploreController }} deps */
export function buildExploreRouter({ exploreController }) {
  const r = Router();
  r.get('/', validateQuery(exploreQuerySchema), wrap(exploreController.places));
  return r;
}
