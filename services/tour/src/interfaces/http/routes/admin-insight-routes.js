// =========================================================
// UC22 (#275) / UC21 (#274) — admin dashboard, action log and violation history. Mounted at /admin
// (gateway: /api/tours/admin/...), after /admin/reviews and /admin/reports.
//   GET /dashboard                    ?from&to (YYYY-MM-DD or ISO; default last 7 days, max 366)
//   GET /actions                      ?adminId&action&targetType&targetId&from&to&page&limit (1..100)
//   GET /actions/:id
//   GET /users/:userId/violations
// The log is append-only: any other method on these paths answers 405 (after the admin check).
// `requireAdmin` is injected (index.js passes shared verifyJwt(['admin'])) and set per route, so other
// /admin/... paths still fall through to the next routers. No ../shared import (CI repo layout).
// =========================================================
import { Router } from 'express';
import { validateParams, validateQuery } from '../middleware/validate.js';
import {
  dashboardQuerySchema,
  adminActionQuerySchema,
  adminActionIdParamSchema,
  violationUserParamSchema,
} from '../../../application/dtos/admin-insight-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const methodNotAllowed = (_req, res) =>
  res
    .status(405)
    .set('Allow', 'GET')
    .json({ error: 'Chỉ được xem, không thể sửa hoặc xoá dữ liệu này', code: 'method_not_allowed' });

/** @param {{ adminInsightController, requireAdmin: import('express').RequestHandler }} deps */
export function buildAdminInsightRouter({ adminInsightController: c, requireAdmin }) {
  if (typeof requireAdmin !== 'function') throw new Error('buildAdminInsightRouter: requireAdmin is required');
  const r = Router();

  r.route('/dashboard')
    .get(requireAdmin, validateQuery(dashboardQuerySchema), wrap(c.dashboard))
    .all(requireAdmin, methodNotAllowed);
  r.route('/actions')
    .get(requireAdmin, validateQuery(adminActionQuerySchema), wrap(c.actions))
    .all(requireAdmin, methodNotAllowed);
  r.route('/actions/:id')
    .get(requireAdmin, validateParams(adminActionIdParamSchema), wrap(c.action))
    .all(requireAdmin, methodNotAllowed);
  r.route('/users/:userId/violations')
    .get(requireAdmin, validateParams(violationUserParamSchema), wrap(c.violations))
    .all(requireAdmin, methodNotAllowed);

  return r;
}
