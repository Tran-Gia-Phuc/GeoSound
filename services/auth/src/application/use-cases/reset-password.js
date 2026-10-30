// =========================================================
// UC01 / A2.2 — Quên mật khẩu (bước 2): xác thực OTP & đặt mật khẩu mới.
// Đặt lại mật khẩu đồng thời gỡ tạm khóa (nếu có).
// UC23 / R7: a password reset signs out every device of the account (reason password_reset).
// =========================================================
import { Email } from '../../domain/value-objects/email.js';
import { Password } from '../../domain/value-objects/password.js';
import { InvalidOtpError, ChallengeNotFoundError } from '../../domain/errors/index.js';
import { REVOKE_REASONS } from '../../domain/entities/session.js';

export class ResetPassword {
  /** @param {{ userRepo, hasher, challenges, sessions?: import('../services/session-manager.js').SessionManager }} deps */
  constructor({ userRepo, hasher, challenges, sessions }) {
    this.sessions = sessions ?? null;
    this.userRepo = userRepo;
    this.hasher = hasher;
    this.challenges = challenges;
  }

  /** @param {{ email: string, otp: string, newPassword: string }} input */
  async execute({ email, otp, newPassword }) {
    const emailVo = new Email(email);
    const passwordVo = new Password(newPassword); // E6

    const challenge = await this.challenges.get('reset', emailVo.value);
    if (!challenge) throw new ChallengeNotFoundError();
    if (String(otp).trim() !== challenge.code) throw new InvalidOtpError(); // E8

    const user = await this.userRepo.findByEmail(emailVo.value);
    if (!user) {
      await this.challenges.delete('reset', emailVo.value);
      throw new InvalidOtpError();
    }

    user.passwordHash = await this.hasher.hash(passwordVo.value);
    user.resetLockout();
    await this.userRepo.save(user);
    await this.challenges.delete('reset', emailVo.value);
    if (this.sessions) await this.sessions.revokeAll(user.id, REVOKE_REASONS.PASSWORD_RESET);

    return { email: emailVo.value };
  }
}
