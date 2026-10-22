// =========================================================
// Composition Root (auth) — ráp (wire) các tầng tại MỘT chỗ duy nhất.
// DI thủ công: infrastructure (impl ports) -> use-case (application) -> controller.
//
//   domain         : KHÔNG import gì ở đây (lõi, thuần JS)
//   application     : use-case nhận ports qua constructor
//   infrastructure  : implement ports (Prisma / Redis / jwt / bcrypt / mail)
//   interfaces/http : controller gọi use-case
//
// Nhờ chỗ này, test use-case bằng fake ports trong RAM (không cần DB).
// =========================================================
import { prisma } from './infrastructure/persistence/prisma-client.js';
import { redis } from './infrastructure/cache/redis-client.js';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user-repository.js';
import { RedisChallengeStore } from './infrastructure/cache/redis-challenge-store.js';
import { BcryptHasher } from './infrastructure/security/bcrypt-hasher.js';
import { JwtTokenService } from './infrastructure/security/jwt-token-service.js';
import { CryptoOtpGenerator } from './infrastructure/security/crypto-otp-generator.js';
import { NodemailerMailer } from './infrastructure/mail/nodemailer-mailer.js';
import { ConsoleMailer } from './infrastructure/mail/console-mailer.js';

import { RegisterUser } from './application/use-cases/register-user.js';
import { VerifyRegistrationOtp } from './application/use-cases/verify-registration-otp.js';
import { ResendOtp } from './application/use-cases/resend-otp.js';
import { Login } from './application/use-cases/login.js';
import { ForgotPassword } from './application/use-cases/forgot-password.js';
import { ResetPassword } from './application/use-cases/reset-password.js';
import { RefreshToken } from './application/use-cases/refresh-token.js';

import { AuthController } from './interfaces/http/controllers/auth-controller.js';
import { buildAuthRouter } from './interfaces/http/routes/auth-routes.js';

export function buildContainer(env = process.env) {
  const otpTtlSeconds = Number(env.OTP_TTL_SECONDS || 120);
  const loginPolicy = {
    maxAttempts: Number(env.LOGIN_MAX_ATTEMPTS || 5),
    lockMs: Number(env.LOGIN_LOCK_MINUTES || 15) * 60_000,
  };

  // --- infrastructure (impl của domain/ports) ---
  const userRepo = new PrismaUserRepository(prisma);
  const challenges = new RedisChallengeStore(redis);
  const hasher = new BcryptHasher(Number(env.BCRYPT_ROUNDS || 10));
  const tokens = new JwtTokenService({
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL || '15m',
    refreshTtl: env.JWT_REFRESH_TTL || '7d',
  });
  const otp = new CryptoOtpGenerator(6);
  // Chưa cấu hình SMTP (dev) -> ConsoleMailer in OTP ra log; có SMTP -> gửi thật.
  const mailer = env.SMTP_USER
    ? new NodemailerMailer({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 587),
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.SMTP_FROM,
      })
    : new ConsoleMailer();

  // --- application (use-cases) ---
  const useCases = {
    registerUser: new RegisterUser({ userRepo, hasher, challenges, otp, mailer, otpTtlSeconds }),
    verifyRegistrationOtp: new VerifyRegistrationOtp({ userRepo, challenges }),
    resendOtp: new ResendOtp({ challenges, otp, mailer, otpTtlSeconds }),
    login: new Login({ userRepo, hasher, tokens, policy: loginPolicy }),
    forgotPassword: new ForgotPassword({ userRepo, challenges, otp, mailer, otpTtlSeconds }),
    resetPassword: new ResetPassword({ userRepo, hasher, challenges }),
    refreshToken: new RefreshToken({ userRepo, tokens }),
  };

  // --- interfaces (controller + router) ---
  const authController = new AuthController(useCases);
  const authRouter = buildAuthRouter({ authController });

  return { authRouter, prisma, redis };
}
