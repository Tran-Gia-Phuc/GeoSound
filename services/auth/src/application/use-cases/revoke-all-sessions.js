// =========================================================
// UC23 / R7, R13 — sign out every device of an account. Used by the password reset and by the
// UC21 admin actions (ban: reason 'banned', suspend: reason 'suspended'; account-actions.js).
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
