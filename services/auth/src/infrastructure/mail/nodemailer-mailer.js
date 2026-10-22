// =========================================================
// Impl của port Mailer bằng Nodemailer (SMTP).
// Dùng khi đã cấu hình SMTP_* trong .env.
// =========================================================
import nodemailer from 'nodemailer';

const SUBJECTS = {
  register: 'Mã OTP đăng ký GeoSound',
  reset: 'Mã OTP đặt lại mật khẩu GeoSound',
};

/** @implements {import('../../domain/ports/index.js').Mailer} */
export class NodemailerMailer {
  /** @param {{ host, port, user, pass, from }} cfg */
  constructor(cfg) {
    this.from = cfg.from;
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  }

  async sendOtp(to, code, purpose) {
    await this.transport.sendMail({
      from: this.from,
      to,
      subject: SUBJECTS[purpose] ?? 'Mã OTP GeoSound',
      text: `Mã OTP của bạn là: ${code}. Mã có hiệu lực trong 2 phút.`,
    });
  }
}
