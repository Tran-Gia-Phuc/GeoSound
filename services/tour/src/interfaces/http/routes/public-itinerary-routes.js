// =========================================================
// Route CÔNG KHAI cho lịch trình được chia sẻ (UC07/A4) — KHÔNG verifyJwt.
// Mount tại '/itineraries' TRƯỚC router có auth để GET /shared/:token không bị
// chặn (giống cách public-tour-routes mount trước tour-routes).
// =========================================================
import { Router } from 'express';
import { validateParams, validateQuery } from '../middleware/validate.js';
import { shareTokenParamSchema, langQuerySchema } from '../../../application/dtos/itinerary-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ exploreController }} deps */
export function buildPublicItineraryRouter({ exploreController }) {
  const r = Router();
  r.get('/shared/:token', validateParams(shareTokenParamSchema), validateQuery(langQuerySchema), wrap(exploreController.shared));
  return r;
}
