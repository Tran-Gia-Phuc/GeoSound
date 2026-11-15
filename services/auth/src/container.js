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
import { PrismaSessionRepository } from './infrastructure/persistence/prisma-session-repository.js';
import { PrismaFollowRepository } from './infrastructure/persistence/prisma-follow-repository.js';
import { RedisRevocationStore } from './infrastructure/cache/redis-revocation-store.js';
import { RedisPresenceStore } from './infrastructure/cache/redis-presence-store.js';
import { NullLocationResolver } from './infrastructure/location/null-location-resolver.js';
import { EventPublisher } from './infrastructure/messaging/event-publisher.js';
import { durationToSeconds } from './infrastructure/security/duration.js';

import { RegisterUser } from './application/use-cases/register-user.js';
import { VerifyRegistrationOtp } from './application/use-cases/verify-registration-otp.js';
import { ResendOtp } from './application/use-cases/resend-otp.js';
import { Login } from './application/use-cases/login.js';
import { ForgotPassword } from './application/use-cases/forgot-password.js';
import { ResetPassword } from './application/use-cases/reset-password.js';
import { RefreshToken } from './application/use-cases/refresh-token.js';
import { SessionManager } from './application/services/session-manager.js';
import { ListSessions } from './application/use-cases/list-sessions.js';
import { RevokeSession } from './application/use-cases/revoke-session.js';
import { RevokeOtherSessions } from './application/use-cases/revoke-other-sessions.js';
import { Logout } from './application/use-cases/logout.js';
import { ChangePassword } from './application/use-cases/change-password.js';
import { GetUserContact } from './application/use-cases/get-user-contact.js';
import { SessionHeartbeat } from './application/use-cases/session-heartbeat.js';
import { GetOnlineDevices } from './application/use-cases/get-online-devices.js';
import { RecordPresence, LeavePresence } from './application/use-cases/record-presence.js';
import { RevokeAllSessions } from './application/use-cases/revoke-all-sessions.js';
import { PurgeEndedSessions } from './application/use-cases/purge-ended-sessions.js';
import { SearchUsers, GetUserForAdmin } from './application/use-cases/admin-users.js';
import { WarnUser, SuspendUser, BanUser, RestoreUser } from './application/use-cases/account-actions.js';
import {
  GetAuthorProfile,
  GetFollowState,
  FollowAuthor,
  UnfollowAuthor,
  ListFollowing,
  GetMyProfile,
  UpdateMyProfile,
} from './application/use-cases/author-page.js';
import { sessionPolicy, presencePolicy } from './config.js';

import { AuthController } from './interfaces/http/controllers/auth-controller.js';
import { AdminUsersController } from './interfaces/http/controllers/admin-users-controller.js';
import { AuthorController } from './interfaces/http/controllers/author-controller.js';
import { buildAuthRouter } from './interfaces/http/routes/auth-routes.js';
import { buildInternalRouter } from './interfaces/http/routes/internal-routes.js';

/**
 * @param {object} env
 * @param {{ verifyJwt?: Function, publish?: Function }} [shared] functions from ../shared, injected by
 *   index.js (only index.js may import ../shared): verifyJwt guards the UC23 and UC21 routes, publish
 *   sends auth.new_device_login and account.moderated.
 */
export function buildContainer(env = process.env, { verifyJwt = null, publish = null } = {}) {
  const otpTtlSeconds = Number(env.OTP_TTL_SECONDS || 120);
  const loginPolicy = {
    maxAttempts: Number(env.LOGIN_MAX_ATTEMPTS || 5),
    lockMs: Number(env.LOGIN_LOCK_MINUTES || 15) * 60_000,
  };

  // --- infrastructure (impl của domain/ports) ---
  const userRepo = new PrismaUserRepository(prisma);
  const challenges = new RedisChallengeStore(redis);
  const hasher = new BcryptHasher(Number(env.BCRYPT_ROUNDS || 10));
  const accessTtl = env.JWT_ACCESS_TTL || '15m';
  const tokens = new JwtTokenService({
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl,
    refreshTtl: env.JWT_REFRESH_TTL || '7d',
  });
  const otp = new CryptoOtpGenerator(6);
  const policy = sessionPolicy(env);
  const sessionRepo = new PrismaSessionRepository(prisma);
  // #329 — every visitor (signed in or not) by device id, for the admin online view.
  const presence = new RedisPresenceStore(redis, { windowSeconds: policy.onlineWindowSeconds, ...presencePolicy(env) });
  const publisher = new EventPublisher({ publish });
  const sessions = new SessionManager({
    sessionRepo,
    tokens,
    revocations: new RedisRevocationStore(redis, { ttlSeconds: durationToSeconds(accessTtl) }),
    locator: new NullLocationResolver(),
    publisher,
    policy,
  });
  // Chưa cấu hình SMTP (dev) -> ConsoleMailer in OTP ra log; có SMTP -> gửi thật.
  const mailer = env.SMTP_USER
    ? new NodemailerMailer({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 587),
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.SMTP_FROM,
        otpTtlSeconds,
      })
    : new ConsoleMailer();

  // --- application (use-cases) ---
  const sessionHeartbeat = new SessionHeartbeat({ sessionRepo, policy });
  const useCases = {
    registerUser: new RegisterUser({ userRepo, hasher, challenges, otp, mailer, otpTtlSeconds }),
    verifyRegistrationOtp: new VerifyRegistrationOtp({ userRepo, challenges }),
    resendOtp: new ResendOtp({ challenges, otp, mailer, otpTtlSeconds }),
    login: new Login({ userRepo, hasher, tokens, policy: loginPolicy, sessions }),
    forgotPassword: new ForgotPassword({ userRepo, challenges, otp, mailer, otpTtlSeconds }),
    resetPassword: new ResetPassword({ userRepo, hasher, challenges, sessions }),
    refreshToken: new RefreshToken({ userRepo, tokens, sessions, sessionRepo, policy }),
    // UC23
    listSessions: new ListSessions({ sessionRepo }),
    revokeSession: new RevokeSession({ sessionRepo, sessions }),
    revokeOtherSessions: new RevokeOtherSessions({ sessions }),
    logout: new Logout({ sessionRepo, sessions }),
    changePassword: new ChangePassword({ userRepo, hasher, sessions }),
    // #265, #329
    sessionHeartbeat,
    getOnlineDevices: new GetOnlineDevices({ sessionRepo, presence, policy }),
    recordPresence: new RecordPresence({ presence, sessionHeartbeat }),
    leavePresence: new LeavePresence({ presence }),
  };
  // UC21 (suspend / ban sign out every device) and the retention job use these directly.
  const revokeAllSessions = new RevokeAllSessions({ sessions });
  // UC21 — admin account actions.
  const actionDeps = { userRepo, revokeAllSessions, publisher };
  const adminUsersController = new AdminUsersController({
    searchUsers: new SearchUsers({ userRepo }),
    getUserForAdmin: new GetUserForAdmin({ userRepo, sessionRepo }),
    warnUser: new WarnUser(actionDeps),
    suspendUser: new SuspendUser(actionDeps),
    banUser: new BanUser(actionDeps),
    restoreUser: new RestoreUser(actionDeps),
  });
  // UC18 — author page, follow, own profile.
  const authorDeps = { userRepo, followRepo: new PrismaFollowRepository(prisma) };
  const authorController = new AuthorController({
    getAuthorProfile: new GetAuthorProfile(authorDeps),
    getFollowState: new GetFollowState(authorDeps),
    followAuthor: new FollowAuthor(authorDeps),
    unfollowAuthor: new UnfollowAuthor(authorDeps),
    listFollowing: new ListFollowing(authorDeps),
    getMyProfile: new GetMyProfile(authorDeps),
    updateMyProfile: new UpdateMyProfile(authorDeps),
  });
  const purgeEndedSessions = new PurgeEndedSessions({ sessionRepo, retentionDays: policy.retentionDays });

  // --- interfaces (controller + router) ---
  const authController = new AuthController(useCases);
  const authRouter = buildAuthRouter({
    authController,
    adminUsersController,
    authorController,
    requireAuth: verifyJwt ? verifyJwt() : null,
    requireAdmin: verifyJwt ? verifyJwt(['admin']) : null, // #265, UC21
  });
  // #258 — service-to-service lookups (Notification), guarded by INTERNAL_SERVICE_TOKEN.
  const internalRouter = buildInternalRouter({
    getUserContact: new GetUserContact({ userRepo }),
    internalToken: env.INTERNAL_SERVICE_TOKEN,
  });

  return { authRouter, internalRouter, prisma, redis, revokeAllSessions, purgeEndedSessions };
}
