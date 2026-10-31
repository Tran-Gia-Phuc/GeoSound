// =========================================================
// Định tuyến HTTP cho auth (sau gateway: /api/auth/* -> ở đây là /*).
// Mỗi route: validateBody(schema) -> controller. Bọc async để lỗi về errorHandler.
// =========================================================
import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import {
  registerSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshSchema,
  changePasswordSchema,
} from '../../../application/dtos/schemas.js';

// Express 4 không bắt rejection của async handler → tự bọc.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * @param {{ authController, requireAuth?: import('express').RequestHandler }} deps
 *   requireAuth = shared verifyJwt() (any role), injected by index.js -> container (UC23 routes).
 */
export function buildAuthRouter({ authController, requireAuth }) {
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
  }

  return r;
}
