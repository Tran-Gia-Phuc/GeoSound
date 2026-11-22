// =========================================================
// Định tuyến HTTP cho tour của contributor (UC09).
// Qua gateway: /api/tours/* -> ở đây là /*.
// Tour "của tôi" nằm dưới /mine để chừa /:id cho tìm kiếm công khai (UC02).
// Mọi route yêu cầu JWT role=contributor (guard verifyJwt được tiêm từ container).
// =========================================================
import { Router } from 'express';
// The contributor guard is injected (container passes shared verifyJwt(['contributor'])): no ../shared import (CI repo layout).
import { validateBody, validateParams } from '../middleware/validate.js';
import { createTourSchema, updateTourSchema, tourIdParamSchema } from '../../../application/dtos/schemas.js';

// Express 4 không bắt rejection của async handler → tự bọc.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ tourController, requireContributor }} deps */
export function buildTourRouter({ tourController, requireContributor }) {
  const r = Router();

  // Chỉ contributor mới quản lý tour.
  r.use(requireContributor);

  r.post('/', validateBody(createTourSchema), wrap(tourController.create));
  r.get('/mine', wrap(tourController.listMine));
  r.get('/mine/:id', validateParams(tourIdParamSchema), wrap(tourController.getOne));
  r.patch('/mine/:id', validateParams(tourIdParamSchema), validateBody(updateTourSchema), wrap(tourController.update));
  r.delete('/mine/:id', validateParams(tourIdParamSchema), wrap(tourController.remove));
  // A3 — xuất bản / gỡ xuống (xuất bản thẳng, D1)
  r.get('/mine/:id/readiness', validateParams(tourIdParamSchema), wrap(tourController.readiness));
  r.post('/mine/:id/publish', validateParams(tourIdParamSchema), wrap(tourController.publish));
  r.post('/mine/:id/unpublish', validateParams(tourIdParamSchema), wrap(tourController.unpublish));

  return r;
}
