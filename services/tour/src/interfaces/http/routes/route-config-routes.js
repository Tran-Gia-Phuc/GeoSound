// =========================================================
// Định tuyến HTTP cho cấu hình route & kích hoạt (UC11). Lồng dưới tour tác giả.
// Qua gateway: /api/tours/mine/:tourId/route-config
// Mọi route yêu cầu JWT role=contributor.
// =========================================================
import { Router } from 'express';
// The contributor guard is injected (container passes shared verifyJwt(['contributor'])): no ../shared import (CI repo layout).
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  saveRouteConfigSchema,
  tourIdParamSchema,
} from '../../../application/dtos/route-config-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ routeConfigController, requireContributor }} deps */
export function buildRouteConfigRouter({ routeConfigController, requireContributor }) {
  const r = Router();

  r.use(requireContributor);

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
