// =========================================================
// Định tuyến HTTP cho xem thử tour (UC13). Lồng dưới tour tác giả.
// Qua gateway: /api/tours/mine/:tourId/preview
// Yêu cầu JWT role=contributor (preview không công khai — chỉ tác giả).
// =========================================================
import { Router } from 'express';
import { verifyJwt } from '../../../../shared/middleware/index.js';
import { validateParams, validateQuery } from '../middleware/validate.js';
import { previewParamsSchema, previewQuerySchema } from '../../../application/dtos/preview-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ previewController }} deps */
export function buildPreviewRouter({ previewController }) {
  const r = Router();

  r.use(verifyJwt(['contributor']));

  r.get(
    '/mine/:tourId/preview',
    validateParams(previewParamsSchema),
    validateQuery(previewQuerySchema),
    wrap(previewController.preview),
  );

  return r;
}
