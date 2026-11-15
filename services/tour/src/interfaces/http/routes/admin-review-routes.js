// =========================================================
// UC19 — admin review routes. Mounted at /admin/reviews (gateway: /api/tours/admin/reviews).
//   GET  /                         queue
//   GET  /:tourId                  dossier
//   POST /:tourId/approve
//   POST /:tourId/reject           { reason }
//   POST /:tourId/request-changes  { reason }
// `requireAdmin` is injected (index.js passes shared verifyJwt(['admin'])): 401 without a valid
// token, 403 for another role. Injection keeps this file free of ../shared imports so it can be
// tested in the repo layout. Mount it BEFORE the contributor routers (they use verifyJwt at
// router level on '/', which would answer 403 to an admin).
// =========================================================
import { Router } from 'express';
import { validateBody, validateParams } from '../middleware/validate.js';
import { reviewTourIdParamSchema, reviewReasonSchema } from '../../../application/dtos/review-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ adminReviewController, requireAdmin: import('express').RequestHandler }} deps */
export function buildAdminReviewRouter({ adminReviewController: c, requireAdmin }) {
  if (typeof requireAdmin !== 'function') throw new Error('buildAdminReviewRouter: requireAdmin is required');
  const r = Router();
  const params = validateParams(reviewTourIdParamSchema);
  const reason = validateBody(reviewReasonSchema, { status: 422 });

  r.use(requireAdmin);

  r.get('/', wrap(c.queue));
  r.get('/:tourId', params, wrap(c.dossier));
  r.post('/:tourId/approve', params, wrap(c.approve));
  r.post('/:tourId/reject', params, reason, wrap(c.reject));
  r.post('/:tourId/request-changes', params, reason, wrap(c.requestChanges));

  return r;
}
