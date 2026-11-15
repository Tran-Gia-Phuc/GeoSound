import { z } from 'zod';
import { buildOtpEmail } from './otp-email-template.js';

// Local mailer API, matching Auth's existing sendOtp(to, code, purpose) port.
// Purpose follows ERD register/reset_pw; legacy Auth reset remains supported.
// This is not a broker payload. Auth still owns OTP generation and expiry.
export function createOtpEmailService({ mailer, ttlSeconds = 120 }) {
  return {
    async sendOtp(to, code, purpose) {
      const recipient = z.string().email().parse(to);
      const content = buildOtpEmail({ code, purpose, ttlSeconds });
      return mailer.send({ to: recipient, ...content });
    },
  };
}
