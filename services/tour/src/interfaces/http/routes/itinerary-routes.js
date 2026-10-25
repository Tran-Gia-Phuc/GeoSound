// =========================================================
// Định tuyến HTTP cho lịch trình cá nhân (UC07) — yêu cầu đăng nhập.
// Qua gateway: /api/itineraries/* -> ở đây là /itineraries/* (xem index.js).
// Chủ sở hữu lấy từ JWT (req.user.sub); không giới hạn vai trò (khách/tác giả
// đều có thể tự lập lịch trình).
// =========================================================
import { Router } from 'express';
import { verifyJwt } from '../../../../shared/middleware/index.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  createItinerarySchema,
  renameItinerarySchema,
  addItemSchema,
  reorderItemsSchema,
  shareSchema,
  itineraryIdParamSchema,
  itemParamSchema,
  langQuerySchema,
} from '../../../application/dtos/itinerary-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ itineraryController }} deps */
export function buildItineraryRouter({ itineraryController }) {
  const r = Router();

  r.use(verifyJwt()); // bất kỳ người dùng đã đăng nhập

  r.post('/', validateBody(createItinerarySchema), wrap(itineraryController.create));
  r.get('/', wrap(itineraryController.listMine));
  r.get('/:id', validateParams(itineraryIdParamSchema), validateQuery(langQuerySchema), wrap(itineraryController.getOne));
  r.patch('/:id', validateParams(itineraryIdParamSchema), validateBody(renameItinerarySchema), wrap(itineraryController.rename));
  r.delete('/:id', validateParams(itineraryIdParamSchema), wrap(itineraryController.remove));

  // Điểm trong lịch trình (A2).
  r.post('/:id/items', validateParams(itineraryIdParamSchema), validateQuery(langQuerySchema), validateBody(addItemSchema), wrap(itineraryController.addItem));
  r.patch('/:id/items', validateParams(itineraryIdParamSchema), validateQuery(langQuerySchema), validateBody(reorderItemsSchema), wrap(itineraryController.reorder));
  r.delete('/:id/items/:itemId', validateParams(itemParamSchema), validateQuery(langQuerySchema), wrap(itineraryController.removeItem));

  // Chia sẻ (A4).
  r.post('/:id/share', validateParams(itineraryIdParamSchema), validateBody(shareSchema), wrap(itineraryController.share));

  return r;
}
