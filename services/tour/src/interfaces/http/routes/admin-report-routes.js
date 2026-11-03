// =========================================================
// UC20 (#273) — admin report routes. Mounted at /admin/reports (gateway: /api/tours/admin/reports).
//   GET  /                   queue  ?page=1&limit=20 (1..50)
//   GET  /:tourId            dossier
//   POST /:tourId/hide       { reason }   (required, 422 without)
//   POST /:tourId/restore    { reason? }
//   POST /:tourId/dismiss    { reason? }
// `requireAdmin` is injected (index.js passes shared verifyJwt(['admin'])): 401 without a valid
// token, 403 for another role. Injection keeps this file free of ../shared imports (CI repo layout).
// Mount it BEFORE the contributor routers (their router-level verifyJwt on '/' would answer 403).
// =========================================================
import { Router } from 'express';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  adminReportTourIdParamSchema,
  reportQueueQuerySchema,
  hideReasonSchema,
  optionalReasonSchema,
} from '../../../application/dtos/admin-report-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ adminReportController, requireAdmin: import('express').RequestHandler }} deps */
export function buildAdminReportRouter({ adminReportController: c, requireAdmin }) {
  if (typeof requireAdmin !== 'function') throw new Error('buildAdminReportRouter: requireAdmin is required');
  const r = Router();
  const params = validateParams(adminReportTourIdParamSchema);
  const required = validateBody(hideReasonSchema, { status: 422 });
  const optional = validateBody(optionalReasonSchema, { status: 422 });

  r.use(requireAdmin);

  r.get('/', validateQuery(reportQueueQuerySchema), wrap(c.queue));
  r.get('/:tourId', params, wrap(c.dossier));
  r.post('/:tourId/hide', params, required, wrap(c.hide));
  r.post('/:tourId/restore', params, optional, wrap(c.restore));
  r.post('/:tourId/dismiss', params, optional, wrap(c.dismiss));

  return r;
}
