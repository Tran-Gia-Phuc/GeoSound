// =========================================================
// UC14 (#269) — restricted access routes (gateway: /api/tours/...).
//   Author (role contributor, owner checked in the use case):
//     GET    /mine/:tourId/access   -> { restricted, passcodeSetAt, testers }
//     PUT    /mine/:tourId/access   { passcode } turn restricted mode on, or change the passcode
//     DELETE /mine/:tourId/access   turn restricted mode off (back to draft)
//   Tester (any signed-in role, AI_PLAN L3 / L9):
//     POST   /:id/unlock            { passcode } -> { unlocked: true } | 403 | 404 | 429
//     GET    /:id/access/mine       -> { unlocked }
//     GET    /:id/restricted?lang=  -> { tour } (same view as the public detail)
//     GET    /:id/restricted/package?lang= -> offline package (UC03 shape + restricted: true, L9)
//     POST   /:id/restricted/translations/:lang -> { tour } automatic translation (UC12, rate limited)
// Guards are injected (index.js passes shared verifyJwt), so this file never imports ../shared.
// Mount it BEFORE the contributor routers: they apply verifyJwt(['contributor']) on '/', which would
// answer 403 to a tourist tester.
// =========================================================
import { Router } from 'express';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  accessTourParamSchema,
  testerTourParamSchema,
  setPasscodeSchema,
  unlockSchema,
} from '../../../application/dtos/access-schemas.js';
import { detailQuerySchema, translateParamSchema } from '../../../application/dtos/detail-schemas.js';
import { UUID } from './public-tour-routes.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * @param {{ tourAccessController, requireAuth: import('express').RequestHandler,
 *           requireContributor: import('express').RequestHandler,
 *           translateLimiter?: import('express').RequestHandler }} deps
 */
export function buildTourAccessRouter({
  tourAccessController: c,
  requireAuth,
  requireContributor,
  translateLimiter = (_req, _res, next) => next(),
}) {
  if (typeof requireAuth !== 'function' || typeof requireContributor !== 'function') {
    throw new Error('buildTourAccessRouter: requireAuth and requireContributor are required');
  }
  const r = Router();
  const owner = [requireContributor, validateParams(accessTourParamSchema)];
  const tester = [requireAuth, validateParams(testerTourParamSchema)];

  r.get('/mine/:tourId/access', ...owner, wrap(c.get));
  r.put('/mine/:tourId/access', ...owner, validateBody(setPasscodeSchema), wrap(c.set));
  r.delete('/mine/:tourId/access', ...owner, wrap(c.disable));

  r.post(`/:id(${UUID})/unlock`, ...tester, validateBody(unlockSchema), wrap(c.unlock));
  r.get(`/:id(${UUID})/access/mine`, ...tester, wrap(c.mine));
  r.get(`/:id(${UUID})/restricted`, ...tester, validateQuery(detailQuerySchema), wrap(c.detail));
  r.get(`/:id(${UUID})/restricted/package`, ...tester, validateQuery(detailQuerySchema), wrap(c.package));
  r.post(
    `/:id(${UUID})/restricted/translations/:lang`,
    requireAuth,
    translateLimiter,
    validateParams(translateParamSchema),
    wrap(c.translate)
  );

  return r;
}
