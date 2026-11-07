// =========================================================
// Định tuyến HTTP cho auth (sau gateway: /api/auth/* -> ở đây là /*).
// Mỗi route: validateBody(schema) -> controller. Bọc async để lỗi về errorHandler.
// =========================================================
import { Router } from 'express';
import { validateBody, validateQuery } from '../middleware/validate.js';
import {
  registerSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshSchema,
  changePasswordSchema,
  adminUsersQuerySchema,
  adminReasonSchema,
  adminRestoreSchema,
  adminSuspendSchema,
  followingQuerySchema,
  updateProfileSchema,
} from '../../../application/dtos/schemas.js';

// Express 4 không bắt rejection của async handler → tự bọc.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * @param {{ authController, adminUsersController?, authorController?, requireAuth?: import('express').RequestHandler, requireAdmin?: import('express').RequestHandler }} deps
 *   requireAuth = shared verifyJwt() (any role), injected by index.js -> container (UC23 routes).
 */
export function buildAuthRouter({ authController, adminUsersController, authorController, requireAuth, requireAdmin }) {
  const r = Router();

  r.post('/register', validateBody(registerSchema), wrap(authController.register));
  r.post('/verify-otp', validateBody(verifyOtpSchema), wrap(authController.verifyOtp));
  r.post('/resend-otp', validateBody(resendOtpSchema), wrap(authController.resendOtp));
  r.post('/login', validateBody(loginSchema), wrap(authController.login));
  r.post('/forgot-password', validateBody(forgotPasswordSchema), wrap(authController.forgotPassword));
  r.post('/reset-password', validateBody(resetPasswordSchema), wrap(authController.resetPassword));
  r.post('/refresh', validateBody(refreshSchema), wrap(authController.refresh));

  // UC23 — signed-in devices (valid access token, any role).
  if (requireAuth) {
    r.get('/sessions', requireAuth, wrap(authController.listSessions));
    r.post('/sessions/revoke-others', requireAuth, wrap(authController.revokeOtherSessions));
    r.delete('/sessions/:id', requireAuth, wrap(authController.revokeSession));
    r.post('/logout', requireAuth, wrap(authController.logout));
    r.post('/change-password', requireAuth, validateBody(changePasswordSchema), wrap(authController.changePassword));
    // #265 — keeps lastActiveAt fresh for the admin online view.
    r.post('/sessions/heartbeat', requireAuth, wrap(authController.heartbeat));
  }

  // #265 — admin: devices known / signed in / online now (role admin only).
  if (requireAdmin) {
    r.get('/admin/sessions', requireAdmin, wrap(authController.onlineDevices));
  }

  // UC21 — admin account actions (role admin only); action bodies answer 422 when invalid, like UC19.
  if (requireAdmin && adminUsersController) {
    const c = adminUsersController;
    const reason = validateBody(adminReasonSchema, { status: 422 });
    r.get('/admin/users', requireAdmin, validateQuery(adminUsersQuerySchema), wrap(c.search));
    r.get('/admin/users/:id', requireAdmin, wrap(c.detail));
    r.post('/admin/users/:id/warn', requireAdmin, reason, wrap(c.warn));
    r.post('/admin/users/:id/suspend', requireAdmin, validateBody(adminSuspendSchema, { status: 422 }), wrap(c.suspend));
    r.post('/admin/users/:id/ban', requireAdmin, reason, wrap(c.ban));
    r.post('/admin/users/:id/restore', requireAdmin, validateBody(adminRestoreSchema, { status: 422 }), wrap(c.restore));
  }

  // UC18 — the author page is public (L3); follow, the follow list and the own profile need sign-in.
  if (authorController) {
    const c = authorController;
    r.get('/authors/:id', wrap(c.profile));
    if (requireAuth) {
      r.get('/authors/:id/follow', requireAuth, wrap(c.followState));
      r.put('/authors/:id/follow', requireAuth, wrap(c.follow));
      r.delete('/authors/:id/follow', requireAuth, wrap(c.unfollow));
      r.get('/me/following', requireAuth, validateQuery(followingQuerySchema), wrap(c.following));
      r.get('/me/profile', requireAuth, wrap(c.myProfile));
      r.patch('/me/profile', requireAuth, validateBody(updateProfileSchema), wrap(c.updateProfile));
    }
  }

  return r;
}
