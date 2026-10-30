// =========================================================
// UC01 — Đăng nhập (Basic Course of Events).
// Xử lý: sai thông tin (E2) + tạm khóa khi sai nhiều lần, tài khoản bị ban (E3).
// UC23: with a SessionManager each sign-in creates (or replaces, R1) a device session and the
// tokens carry its `sid`. Without one (old wiring, unit tests) tokens are issued as before.
// =========================================================
import {
  InvalidCredentialsError,
  AccountBannedError,
  AccountLockedError,
} from '../../domain/errors/index.js';

export class Login {
  /** @param {{ userRepo, hasher, tokens, policy: { maxAttempts: number, lockMs: number }, sessions?: import('../services/session-manager.js').SessionManager, now?: () => Date }} deps */
  constructor({ userRepo, hasher, tokens, policy, sessions, now }) {
    this.userRepo = userRepo;
    this.sessions = sessions ?? null;
    this.hasher = hasher;
    this.tokens = tokens;
    this.policy = policy;
    this.now = now ?? (() => new Date());
  }

  /** @param {{ email: string, password: string, deviceId?: string, userAgent?: string, ip?: string }} input */
  async execute({ email, password, deviceId, userAgent, ip }) {
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const user = await this.userRepo.findByEmail(normalizedEmail);

    // Không tiết lộ email có tồn tại hay không (E2 — thông báo chung).
    if (!user) throw new InvalidCredentialsError();

    // E3 — tài khoản bị ban (UC21).
    if (user.isBanned()) throw new AccountBannedError(user.banReason);

    // E2 (nâng cao) — đang trong thời gian tạm khóa.
    if (user.isLocked(this.now())) throw new AccountLockedError(user.lockedUntil);

    const ok = await this.hasher.compare(password, user.passwordHash);
    if (!ok) {
      user.registerFailedLogin({
        maxAttempts: this.policy.maxAttempts,
        lockMs: this.policy.lockMs,
        now: this.now(),
      });
      await this.userRepo.save(user);
      if (user.isLocked(this.now())) throw new AccountLockedError(user.lockedUntil);
      throw new InvalidCredentialsError();
    }

    // Đăng nhập đúng → xóa bộ đếm sai & cấp token.
    if (user.failedAttempts !== 0 || user.lockedUntil) {
      user.resetLockout();
      await this.userRepo.save(user);
    }

    if (this.sessions) {
      const { tokens } = await this.sessions.start({ user, deviceId, userAgent, ip });
      return { user: user.toPublic(), ...tokens };
    }
    const tokens = this.tokens.issueTokens(user);
    return { user: user.toPublic(), ...tokens };
  }
}
