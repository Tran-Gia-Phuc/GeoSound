// =========================================================
// Composition Root (auth) — ráp (wire) các tầng tại MỘT chỗ duy nhất.
// DI thủ công: tạo infrastructure (impl của ports) → tiêm vào use-case
// (application) → tiêm use-case vào controller (interfaces).
//
//   domain         : KHÔNG import gì ở đây (lõi, thuần JS)
//   application     : use-case nhận ports qua constructor
//   infrastructure  : implement ports (Prisma / Redis / jwt / bcrypt / mail)
//   interfaces/http : controller gọi use-case
//
// Nhờ chỗ này, test use-case bằng fake ports trong RAM (không cần DB).
// =========================================================

export function buildContainer(/* { prisma, redis, env, publish } */) {
  // --- infrastructure (impl của domain/ports) ---
  // const userRepo  = new PrismaUserRepository(prisma);
  // const hasher    = new BcryptHasher();
  // const tokens    = new JwtTokenService(env);
  // const otpStore  = new RedisOtpStore(redis);
  // const mailer    = new NodemailerMailer(env);

  // --- application (use-cases) ---
  // const registerUser = new RegisterUser({ userRepo, hasher, otpStore, mailer });
  // const login        = new Login({ userRepo, hasher, tokens });

  // --- interfaces (controllers) ---
  // const authController = new AuthController({ registerUser, login });

  // return { authController };
  return {};
}
