// =========================================================
// UC23 / R4 — "Đăng xuất": ends the current session (its refresh token stops working and
// its access token is rejected at once, 5.3). A token without `sid` has nothing to end.
// =========================================================
import { REVOKE_REASONS } from '../../domain/entities/session.js';

export class Logout {
  /** @param {{ sessionRepo, sessions: import('../services/session-manager.js').SessionManager }} deps */
  constructor({ sessionRepo, sessions }) {
    this.sessionRepo = sessionRepo;
    this.sessions = sessions;
  }

  /** @param {{ userId: string, currentSid?: string|null }} input */
  async execute({ userId, currentSid = null }) {
    if (!currentSid) return { revoked: false };
    const session = await this.sessionRepo.findById(currentSid);
    if (!session || session.userId !== userId) return { revoked: false };
    return { revoked: await this.sessions.revoke(session, REVOKE_REASONS.USER) };
  }
}
