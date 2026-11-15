// =========================================================
// UC01 / A3 — Gửi lại OTP (cho cả luồng đăng ký lẫn quên mật khẩu).
// Chỉ gửi lại nếu phiên thử thách còn tồn tại; tạo mã mới & gia hạn TTL.
// =========================================================
import { Email } from '../../domain/value-objects/email.js';
import { ChallengeNotFoundError } from '../../domain/errors/index.js';

export class ResendOtp {
  /** @param {{ challenges, otp, mailer, otpTtlSeconds: number }} deps */
  constructor({ challenges, otp, mailer, otpTtlSeconds }) {
    this.challenges = challenges;
    this.otp = otp;
    this.mailer = mailer;
    this.otpTtlSeconds = otpTtlSeconds;
  }

  /** @param {{ email: string, purpose?: 'register'|'reset' }} input */
  async execute({ email, purpose = 'register' }) {
    const emailVo = new Email(email);

    const challenge = await this.challenges.get(purpose, emailVo.value);
    if (!challenge) throw new ChallengeNotFoundError();

    const code = this.otp.generate();
    await this.challenges.save(purpose, emailVo.value, { ...challenge, code }, this.otpTtlSeconds);
    await this.mailer.sendOtp(emailVo.value, code, purpose);

    return { email: emailVo.value, otpTtlSeconds: this.otpTtlSeconds };
  }
}
