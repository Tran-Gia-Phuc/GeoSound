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
} from '../../../application/dtos/schemas.js';

// Express 4 không bắt rejection của async handler → tự bọc.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ authController }} deps */
export function buildAuthRouter({ authController }) {
  const r = Router();

  r.post('/register', validateBody(registerSchema), wrap(authController.register));
  r.post('/verify-otp', validateBody(verifyOtpSchema), wrap(authController.verifyOtp));
  r.post('/resend-otp', validateBody(resendOtpSchema), wrap(authController.resendOtp));
  r.post('/login', validateBody(loginSchema), wrap(authController.login));
  r.post('/forgot-password', validateBody(forgotPasswordSchema), wrap(authController.forgotPassword));
  r.post('/reset-password', validateBody(resetPasswordSchema), wrap(authController.resetPassword));
  r.post('/refresh', validateBody(refreshSchema), wrap(authController.refresh));

  return r;
}
