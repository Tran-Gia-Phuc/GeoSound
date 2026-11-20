// =========================================================
// UC25 (#446) — payment routes (gateway: /api/tours/...).
//   Author (role contributor, owner checked in the use case):
//     GET  /mine/:tourId/price      -> { price, paidCount, revenue }
//     PUT  /mine/:tourId/price      { price } (0 or 1 000..50 000 000 VND)
//     GET  /mine/:tourId/sales      -> { items: [{ orderId, amount, paidAt, buyer }] } (paid only)
//   Buyer (any signed-in role):
//     POST /:id/purchase            -> 201 { orderId, payUrl } | 400 tour_free / own_tour | 409 | 503
//     GET  /:id/purchase/mine       -> { price, purchased, owner }
//     GET  /purchases/mine          -> { items: [{ orderId, tourId, tourTitle, status, amount, transId, createdAt, paidAt }] }
//   Admin:
//     GET  /admin/payments?status=&page=&limit= -> { items, total, page, limit, paidCount, revenue }
//   Public:
//     GET  /payments/:orderId       -> { orderId, tourId, status, amount } (asks MoMo while pending)
//     POST /payments/momo/ipn       MoMo notification, signature checked -> 204
// Guards are injected (no ../shared import). Mount BEFORE the contributor routers.
// =========================================================
import { Router } from 'express';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { priceTourParamSchema, buyTourParamSchema, orderParamSchema, setPriceSchema, adminPaymentsQuerySchema } from '../../../application/dtos/payment-schemas.js';
import { UUID } from './public-tour-routes.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ tourPaymentController, requireAuth, requireContributor, requireAdmin: import('express').RequestHandler }} deps */
export function buildTourPaymentRouter({ tourPaymentController: c, requireAuth, requireContributor, requireAdmin }) {
  if ([requireAuth, requireContributor, requireAdmin].some((g) => typeof g !== 'function')) {
    throw new Error('buildTourPaymentRouter: requireAuth, requireContributor and requireAdmin are required');
  }
  const r = Router();
  const owner = [requireContributor, validateParams(priceTourParamSchema)];
  const buyer = [requireAuth, validateParams(buyTourParamSchema)];

  r.get('/mine/:tourId/price', ...owner, wrap(c.getPrice));
  r.put('/mine/:tourId/price', ...owner, validateBody(setPriceSchema), wrap(c.setPrice));
  r.get('/mine/:tourId/sales', ...owner, wrap(c.sales));

  r.get('/purchases/mine', requireAuth, wrap(c.history));
  r.get('/admin/payments', requireAdmin, validateQuery(adminPaymentsQuerySchema), wrap(c.adminList));

  r.post(`/:id(${UUID})/purchase`, ...buyer, wrap(c.purchase));
  r.get(`/:id(${UUID})/purchase/mine`, ...buyer, wrap(c.mine));

  r.post('/payments/momo/ipn', wrap(c.ipn));
  r.get('/payments/:orderId', validateParams(orderParamSchema), wrap(c.status));

  return r;
}
