// =========================================================
// UC01 / A1.7–A1.9 — Xác thực OTP đăng ký rồi tạo tài khoản.
// =========================================================
import { Email } from '../../domain/value-objects/email.js';
import { User } from '../../domain/entities/user.js';
import {
  InvalidOtpError,
  ChallengeNotFoundError,
  EmailAlreadyExistsError,
} from '../../domain/errors/index.js';

export class VerifyRegistrationOtp {
  /** @param {{ userRepo, challenges }} deps */
  constructor({ userRepo, challenges }) {
    this.userRepo = userRepo;
    this.challenges = challenges;
  }

  /** @param {{ email: string, otp: string }} input */
  async execute({ email, otp }) {
    const emailVo = new Email(email);

    const challenge = await this.challenges.get('register', emailVo.value);
    if (!challenge) throw new ChallengeNotFoundError(); // hết hạn trước khi nhập OTP

    if (String(otp).trim() !== challenge.code) throw new InvalidOtpError(); // E8

    // Phòng trường hợp email bị đăng ký xen giữa chừng.
    if (await this.userRepo.findByEmail(emailVo.value)) {
      await this.challenges.delete('register', emailVo.value);
      throw new EmailAlreadyExistsError();
    }

    const user = await this.userRepo.create(
      new User({
        email: emailVo.value,
        passwordHash: challenge.passwordHash,
        fullName: challenge.fullName,
        role: challenge.role,
      })
    );
    await this.challenges.delete('register', emailVo.value);

    return user.toPublic();
  }
}
