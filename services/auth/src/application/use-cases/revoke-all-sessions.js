// =========================================================
// UC23 / R7, R13 — sign out every device of an account. Used by the password reset;
// exposed for UC21 (ban, reason 'banned'): Auth has no ban endpoint yet, so the ban
// use case calls this when it is built.
// =========================================================
import { REVOKE_REASONS } from '../../domain/entities/session.js';

export class RevokeAllSessions {
  /** @param {{ sessions: import('../services/session-manager.js').SessionManager }} deps */
  constructor({ sessions }) {
    this.sessions = sessions;
  }

  /** @param {{ userId: string, reason?: string }} input */
  async execute({ userId, reason = REVOKE_REASONS.BANNED }) {
    const revoked = await this.sessions.revokeAll(userId, reason);
    return { revoked };
  }
}
