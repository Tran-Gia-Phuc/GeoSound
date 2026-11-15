// =========================================================
// Định tuyến HTTP cho điểm dừng (UC10). Lồng dưới tour của contributor.
// Qua gateway: /api/tours/mine/:tourId/places...
// Mọi route yêu cầu JWT role=contributor.
// =========================================================
import { Router } from 'express';
import { verifyJwt } from '../../../../shared/middleware/index.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  addPlaceSchema,
  updatePlaceSchema,
  reorderPlacesSchema,
  tourIdParamSchema,
  placeParamsSchema,
} from '../../../application/dtos/place-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ placeController }} deps */
export function buildPlaceRouter({ placeController }) {
  const r = Router();

  r.use(verifyJwt(['contributor']));

  r.post('/mine/:tourId/places', validateParams(tourIdParamSchema), validateBody(addPlaceSchema), wrap(placeController.add));
  r.get('/mine/:tourId/places', validateParams(tourIdParamSchema), wrap(placeController.list));

  // Đặt trước /:placeId để "reorder" không bị bắt làm placeId.
  r.patch('/mine/:tourId/places/reorder', validateParams(tourIdParamSchema), validateBody(reorderPlacesSchema), wrap(placeController.reorder));

  r.patch('/mine/:tourId/places/:placeId', validateParams(placeParamsSchema), validateBody(updatePlaceSchema), wrap(placeController.update));
  r.delete('/mine/:tourId/places/:placeId', validateParams(placeParamsSchema), wrap(placeController.remove));

  return r;
}
