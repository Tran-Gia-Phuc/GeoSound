// =========================================================
// UC01 / A2.1–A2.2 — Quên mật khẩu (bước 1): gửi OTP đặt lại.
// Luôn trả về chung chung để tránh dò email tồn tại (account enumeration);
// chỉ thực sự tạo thử thách + gửi mail khi tài khoản có thật & chưa bị ban.
// =========================================================
import { Email } from '../../domain/value-objects/email.js';

export class ForgotPassword {
  /** @param {{ userRepo, challenges, otp, mailer, otpTtlSeconds: number }} deps */
  constructor({ userRepo, challenges, otp, mailer, otpTtlSeconds }) {
    this.userRepo = userRepo;
    this.challenges = challenges;
    this.otp = otp;
    this.mailer = mailer;
    this.otpTtlSeconds = otpTtlSeconds;
  }

  /** @param {{ email: string }} input */
  async execute({ email }) {
    const emailVo = new Email(email);
    const user = await this.userRepo.findByEmail(emailVo.value);

    if (user && !user.isBanned()) {
      const code = this.otp.generate();
      await this.challenges.save('reset', emailVo.value, { code }, this.otpTtlSeconds);
      await this.mailer.sendOtp(emailVo.value, code, 'reset');
    }

    return { email: emailVo.value, otpTtlSeconds: this.otpTtlSeconds };
  }
}
