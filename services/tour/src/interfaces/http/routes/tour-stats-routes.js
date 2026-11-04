// =========================================================
// UC17 (#271) — statistics routes (gateway: /api/tours/...).
//   POST /:id/activity     public, optional sign-in, { action, language?, deviceId? } -> 204
//   GET  /mine/:id/stats   contributor (own tour) or admin, ?from=&to=&language=
// Guards are injected (index.js passes shared verifyJwt), so this file never imports ../shared (CI repo
// layout). Mount it BEFORE the contributor routers: they apply verifyJwt(['contributor']) on '/', which
// would answer 403 to an admin (stats) and 401 to an anonymous visitor (activity).
// =========================================================
import { Router } from 'express';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { statsTourParamSchema, recordActivitySchema, statsQuerySchema } from '../../../application/dtos/stats-schemas.js';
import { UUID } from './public-tour-routes.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * @param {{ tourStatsController, optionalAuth: import('express').RequestHandler,
 *           requireOwnerRole: import('express').RequestHandler }} deps
 */
export function buildTourStatsRouter({ tourStatsController: c, optionalAuth, requireOwnerRole }) {
  if (typeof optionalAuth !== 'function') throw new Error('buildTourStatsRouter: optionalAuth is required');
  if (typeof requireOwnerRole !== 'function') throw new Error('buildTourStatsRouter: requireOwnerRole is required');
  const r = Router();
  const params = validateParams(statsTourParamSchema);

  r.post(`/:id(${UUID})/activity`, optionalAuth, params, validateBody(recordActivitySchema), wrap(c.record));
  r.get(`/mine/:id(${UUID})/stats`, requireOwnerRole, params, validateQuery(statsQuerySchema), wrap(c.stats));

  return r;
}
