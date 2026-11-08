// =========================================================
// Impl của port Mailer bằng Nodemailer (SMTP).
// Dùng khi đã cấu hình SMTP_* trong .env.
// UC01: the OTP email has an HTML version (otp-email-template.js) plus the plain text one.
// If the template cannot render (unexpected code / purpose), the plain text email is still sent:
// a broken template must never block sign-up or password reset.
// =========================================================
import nodemailer from 'nodemailer';
import { buildOtpEmail } from './otp-email-template.js';

const SUBJECTS = {
  register: 'Mã OTP đăng ký GeoSound',
  reset: 'Mã OTP đặt lại mật khẩu GeoSound',
};

/** Pure: { subject, text, html? } of one OTP email. */
export function otpMessage(code, purpose, ttlSeconds = 120) {
  try {
    return buildOtpEmail({ code: String(code), purpose, ttlSeconds });
  } catch {
    const minutes = ttlSeconds % 60 === 0 ? `${ttlSeconds / 60} phút` : `${ttlSeconds} giây`;
    return {
      subject: SUBJECTS[purpose] ?? 'Mã OTP GeoSound',
      text: `Mã OTP của bạn là: ${code}. Mã có hiệu lực trong ${minutes}.`,
    };
  }
}

/** @implements {import('../../domain/ports/index.js').Mailer} */
export class NodemailerMailer {
  /** @param {{ host, port, user, pass, from, otpTtlSeconds?, transport? }} cfg */
  constructor(cfg) {
    this.from = cfg.from;
    this.otpTtlSeconds = cfg.otpTtlSeconds ?? 120;
    this.transport =
      cfg.transport ??
      nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      });
  }

  async sendOtp(to, code, purpose) {
    await this.transport.sendMail({ from: this.from, to, ...otpMessage(code, purpose, this.otpTtlSeconds) });
  }
}
