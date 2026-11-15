// =========================================================
// UC23 / R5 — sign out all other devices; the current one stays signed in.
// =========================================================
import { REVOKE_REASONS } from '../../domain/entities/session.js';

export class RevokeOtherSessions {
  /** @param {{ sessions: import('../services/session-manager.js').SessionManager }} deps */
  constructor({ sessions }) {
    this.sessions = sessions;
  }

  /** @param {{ userId: string, currentSid?: string|null }} input */
  async execute({ userId, currentSid = null }) {
    const revoked = await this.sessions.revokeAll(userId, REVOKE_REASONS.USER_ALL, { exceptSid: currentSid });
    return { revoked };
  }
}
