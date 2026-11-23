// =========================================================
// Định tuyến HTTP cho xem thử tour (UC13). Lồng dưới tour tác giả.
// Qua gateway: /api/tours/mine/:tourId/preview
// Yêu cầu JWT role=contributor (preview không công khai — chỉ tác giả).
// =========================================================
import { Router } from 'express';
// The contributor guard is injected (container passes shared verifyJwt(['contributor'])): no ../shared import (CI repo layout).
import { validateParams, validateQuery } from '../middleware/validate.js';
import { previewParamsSchema, previewQuerySchema } from '../../../application/dtos/preview-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ previewController, requireContributor }} deps */
export function buildPreviewRouter({ previewController, requireContributor }) {
  const r = Router();

  r.use(requireContributor);

  r.get(
    '/mine/:tourId/preview',
    validateParams(previewParamsSchema),
    validateQuery(previewQuerySchema),
    wrap(previewController.preview),
  );

  return r;
}
