// =========================================================
// UC06 (#268) — report routes (gateway: /api/tours/:id/reports...).
//   POST /:id/reports        signed in, { reason, note? } -> 201 { report, flagged }
//   GET  /:id/reports/mine   signed in -> { report: { reason, note, createdAt } | null }
// `requireAuth` is injected (index.js passes shared verifyJwt(), any role), so this file never
// imports ../shared (CI repo layout). Mount it BEFORE the contributor routers: they apply
// verifyJwt(['contributor']) on '/', which would answer 403 to a tourist.
// =========================================================
import { Router } from 'express';
import { validateBody, validateParams } from '../middleware/validate.js';
import { reportTourParamSchema, reportTourSchema } from '../../../application/dtos/report-schemas.js';
import { UUID } from './public-tour-routes.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ tourReportController, requireAuth: import('express').RequestHandler }} deps */
export function buildTourReportRouter({ tourReportController: c, requireAuth }) {
  if (typeof requireAuth !== 'function') throw new Error('buildTourReportRouter: requireAuth is required');
  const r = Router();
  const params = validateParams(reportTourParamSchema);

  r.post(`/:id(${UUID})/reports`, requireAuth, params, validateBody(reportTourSchema), wrap(c.report));
  r.get(`/:id(${UUID})/reports/mine`, requireAuth, params, wrap(c.mine));

  return r;
}
