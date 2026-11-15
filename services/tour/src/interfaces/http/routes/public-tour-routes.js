// =========================================================
// Định tuyến HTTP công khai cho tour (UC02). KHÔNG yêu cầu đăng nhập.
// Qua gateway: /api/tours  (tìm kiếm) và /api/tours/:id (chi tiết).
//
// MOUNT TRƯỚC router của contributor. Route chi tiết ràng buộc :id dạng UUID
// để KHÔNG nuốt các path của contributor như /mine, /mine/:tourId/places...
// (những path đó rơi xuống router sau).
// =========================================================
import { Router } from 'express';
import { validateQuery, validateParams } from '../middleware/validate.js';
import { searchQuerySchema } from '../../../application/dtos/search-schemas.js';
import { detailParamSchema, detailQuerySchema, translateParamSchema } from '../../../application/dtos/detail-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// UUID v-any: 8-4-4-4-12 hex (loại trừ "mine" và các path khác).
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * @param {{ publicTourController, translateLimiter?: import('express').RequestHandler }} deps
 *   translateLimiter: rate limit of the automatic translation route (calls the AI service).
 */
export function buildPublicTourRouter({ publicTourController, translateLimiter = (_req, _res, next) => next() }) {
  const r = Router();

  // Bước 1–5 — tìm kiếm công khai.
  r.get('/', validateQuery(searchQuerySchema), wrap(publicTourController.search));

  // Bước 6–9 — chi tiết. Ràng buộc :id dạng UUID để /mine... rơi xuống router sau.
  r.get(
    `/:id(${UUID})`,
    validateParams(detailParamSchema),
    validateQuery(detailQuerySchema),
    wrap(publicTourController.detail)
  );

  // UC03 (#103) — offline package manifest of a public tour for one language.
  r.get(
    `/:id(${UUID})/package`,
    validateParams(detailParamSchema),
    validateQuery(detailQuerySchema),
    wrap(publicTourController.package)
  );

  // UC04 / UC12 — a tourist asks for a language that is not available yet (automatic translation).
  r.post(
    `/:id(${UUID})/translations/:lang`,
    translateLimiter,
    validateParams(translateParamSchema),
    wrap(publicTourController.translate)
  );

  return r;
}

export { UUID };
