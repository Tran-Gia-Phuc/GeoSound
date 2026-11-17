// =========================================================
// UC05 — Rating report routes:
//   POST /:id/ratings/:ratingUserId/reports   (any signed-in user)
//   GET  /admin/rating-reports                (admin only)
//   POST /admin/rating-reports/:reportId/resolve (admin only)
// =========================================================
import { Router } from 'express';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  submitRatingReportParamsSchema,
  submitRatingReportBodySchema,
  adminRatingReportQuerySchema,
  resolveRatingReportParamsSchema,
  resolveRatingReportBodySchema,
} from '../../../application/dtos/rating-report-schemas.js';
import { UUID } from './public-tour-routes.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function buildTourRatingReportRouter({ tourRatingReportController: c, requireAuth }) {
  if (typeof requireAuth !== 'function') throw new Error('buildTourRatingReportRouter: requireAuth is required');
  const r = Router();
  r.post(
    `/:id(${UUID})/ratings/:ratingUserId(${UUID})/reports`,
    requireAuth,
    validateParams(submitRatingReportParamsSchema),
    validateBody(submitRatingReportBodySchema),
    wrap(c.submit),
  );
  return r;
}

export function buildAdminRatingReportRouter({ tourRatingReportController: c, requireAdmin }) {
  if (typeof requireAdmin !== 'function') throw new Error('buildAdminRatingReportRouter: requireAdmin is required');
  const r = Router();
  r.use(requireAdmin);
  r.get('/', validateQuery(adminRatingReportQuerySchema), wrap(c.listAdmin));
  r.post(
    `/:reportId(${UUID})/resolve`,
    validateParams(resolveRatingReportParamsSchema),
    validateBody(resolveRatingReportBodySchema),
    wrap(c.resolve),
  );
  return r;
}
