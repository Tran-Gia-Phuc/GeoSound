// =========================================================
// UC05 (#267) — rating routes (gateway: /api/tours/:id/ratings...).
//   GET    /:id/ratings        public list + summary
//   GET    /:id/ratings/mine   signed in
//   PUT    /:id/ratings/mine   signed in, { stars, comment? } -> 201 created | 200 updated
//   DELETE /:id/ratings/mine   signed in -> 204
// `requireAuth` is injected (index.js passes shared verifyJwt(), any role), so this file never
// imports ../shared (CI repo layout). Mount it BEFORE the contributor routers: they apply
// verifyJwt(['contributor']) on '/', which would answer 403 to a tourist.
// =========================================================
import { Router } from 'express';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  ratingTourParamSchema,
  ratingListQuerySchema,
  saveRatingSchema,
} from '../../../application/dtos/rating-schemas.js';
import { UUID } from './public-tour-routes.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ tourRatingController, requireAuth: import('express').RequestHandler }} deps */
export function buildTourRatingRouter({ tourRatingController: c, requireAuth }) {
  if (typeof requireAuth !== 'function') throw new Error('buildTourRatingRouter: requireAuth is required');
  const r = Router();
  const params = validateParams(ratingTourParamSchema);

  r.get(`/:id(${UUID})/ratings`, params, validateQuery(ratingListQuerySchema), wrap(c.list));
  r.get(`/:id(${UUID})/ratings/mine`, requireAuth, params, wrap(c.mine));
  r.put(`/:id(${UUID})/ratings/mine`, requireAuth, params, validateBody(saveRatingSchema), wrap(c.save));
  r.delete(`/:id(${UUID})/ratings/mine`, requireAuth, params, wrap(c.remove));

  return r;
}
