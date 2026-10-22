// =========================================================
// Định tuyến HTTP cho cấu hình route & kích hoạt (UC11). Lồng dưới tour tác giả.
// Qua gateway: /api/tours/mine/:tourId/route-config
// Mọi route yêu cầu JWT role=contributor.
// =========================================================
import { Router } from 'express';
import { verifyJwt } from '../../../../shared/middleware/index.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  saveRouteConfigSchema,
  tourIdParamSchema,
} from '../../../application/dtos/route-config-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ routeConfigController }} deps */
export function buildRouteConfigRouter({ routeConfigController }) {
  const r = Router();

  r.use(verifyJwt(['contributor']));

  r.get(
    '/mine/:tourId/route-config',
    validateParams(tourIdParamSchema),
    wrap(routeConfigController.get)
  );
  r.put(
    '/mine/:tourId/route-config',
    validateParams(tourIdParamSchema),
    validateBody(saveRouteConfigSchema),
    wrap(routeConfigController.save)
  );

  return r;
}
