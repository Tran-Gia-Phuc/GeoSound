// =========================================================
// UC01 / A1 — Đăng ký (bước 1): nhận thông tin, gửi OTP.
// Chưa tạo User ở bước này; thông tin đăng ký được giữ tạm trong ChallengeStore
// (Redis, TTL = OTP) tới khi người dùng xác thực OTP (xem VerifyRegistrationOtp).
// =========================================================
import { Email } from '../../domain/value-objects/email.js';
import { Password } from '../../domain/value-objects/password.js';
import { ROLES } from '../../domain/entities/user.js';
import { EmailAlreadyExistsError } from '../../domain/errors/index.js';

export class RegisterUser {
  /** @param {{ userRepo, hasher, challenges, otp, mailer, otpTtlSeconds: number }} deps */
  constructor({ userRepo, hasher, challenges, otp, mailer, otpTtlSeconds }) {
    this.userRepo = userRepo;
    this.hasher = hasher;
    this.challenges = challenges;
    this.otp = otp;
    this.mailer = mailer;
    this.otpTtlSeconds = otpTtlSeconds;
  }

  /** @param {{ fullName: string, email: string, password: string, role?: string }} input */
  async execute({ fullName, email, password, role }) {
    const emailVo = new Email(email); // E5
    const passwordVo = new Password(password); // E6

    // E7 — email đã tồn tại.
    const existing = await this.userRepo.findByEmail(emailVo.value);
    if (existing) throw new EmailAlreadyExistsError();

    const passwordHash = await this.hasher.hash(passwordVo.value);
    const code = this.otp.generate();

    await this.challenges.save(
      'register',
      emailVo.value,
      { code, fullName: fullName.trim(), passwordHash, role: role ?? ROLES.TOURIST },
      this.otpTtlSeconds
    );
    await this.mailer.sendOtp(emailVo.value, code, 'register');

    return { email: emailVo.value, otpTtlSeconds: this.otpTtlSeconds };
  }
}
