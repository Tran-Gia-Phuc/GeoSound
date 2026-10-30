// =========================================================
// UC01 (hỗ trợ) — Làm mới access token từ refresh token.
// UC23 (docs/02-design/device-sessions.md 5.2), when a SessionManager is wired:
//   - token with `sid`: the session must be active (not revoked, not past 7 days idle /
//     30 days absolute, R8) and the token must be its current one; an old token means
//     reuse (R11) -> the session is signed out. Otherwise the refresh token rotates.
//   - old token without `sid` (issued before UC23): a session is created for it so the
//     device appears in the list from now on (no new-device email). See 5.5.
// =========================================================
import { InvalidTokenError, AccountBannedError, SessionRevokedError } from '../../domain/errors/index.js';
import { REVOKE_REASONS } from '../../domain/entities/session.js';

export class RefreshToken {
  /**
   * @param {{ userRepo, tokens, sessions?: import('../services/session-manager.js').SessionManager,
   *   sessionRepo?: import('../../domain/ports/index.js').SessionRepository,
   *   policy?: { idleDays: number, maxDays: number }, now?: () => Date }} deps
   */
  constructor({ userRepo, tokens, sessions, sessionRepo, policy, now }) {
    this.userRepo = userRepo;
    this.tokens = tokens;
    this.sessions = sessions ?? null;
    this.sessionRepo = sessionRepo ?? null;
    this.policy = policy ?? null;
    this.now = now ?? (() => new Date());
  }

  /** @param {{ refreshToken: string, deviceId?: string, userAgent?: string, ip?: string }} input */
  async execute({ refreshToken, deviceId, userAgent, ip }) {
    let decoded;
    try {
      decoded = this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw new InvalidTokenError();
    }

    const user = await this.userRepo.findById(decoded.sub);
    if (!user) throw new InvalidTokenError();
    if (user.isBanned()) throw new AccountBannedError(user.banReason);

    if (!this.sessions) {
      const tokens = this.tokens.issueTokens(user);
      return { user: user.toPublic(), ...tokens };
    }

    // Legacy token (no sid): attach it to a new session from now on.
    if (!decoded.sid) {
      const { tokens } = await this.sessions.start({ user, deviceId, userAgent, ip, alert: false });
      return { user: user.toPublic(), ...tokens };
    }

    const session = await this.sessionRepo.findById(decoded.sid);
    if (!session || session.userId !== user.id) throw new SessionRevokedError();
    if (session.isRevoked()) throw new SessionRevokedError();

    const now = this.now();
    if (session.isExpired(now)) {
      await this.sessions.revoke(session, REVOKE_REASONS.EXPIRED);
      throw new SessionRevokedError();
    }

    // R11 — only the latest refresh token of a session is valid; an older one is a theft signal.
    if (this.tokens.hashRefresh(refreshToken) !== session.refreshHash) {
      await this.sessions.revoke(session, REVOKE_REASONS.REUSE);
      throw new SessionRevokedError();
    }

    const tokens = this.tokens.issueTokens(user, { sid: session.id });
    session.touch({
      refreshHash: this.tokens.hashRefresh(tokens.refreshToken),
      ipAddress: ip ?? null,
      now,
      policy: this.policy,
    });
    await this.sessionRepo.save(session);
    return { user: user.toPublic(), ...tokens };
  }
}
