// =========================================================
// UC23 / R4 — sign out one other device. 404 for an unknown session or one of another
// user (same answer, nothing leaks); 409 for the current device (use logout).
// =========================================================
import { SessionNotFoundError, CurrentSessionError } from '../../domain/errors/index.js';
import { REVOKE_REASONS } from '../../domain/entities/session.js';

export class RevokeSession {
  /** @param {{ sessionRepo, sessions: import('../services/session-manager.js').SessionManager, now?: () => Date }} deps */
  constructor({ sessionRepo, sessions, now }) {
    this.sessionRepo = sessionRepo;
    this.sessions = sessions;
    this.now = now ?? (() => new Date());
  }

  /** @param {{ userId: string, currentSid?: string|null, sessionId: string }} input */
  async execute({ userId, currentSid = null, sessionId }) {
    if (currentSid && sessionId === currentSid) throw new CurrentSessionError();
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId || !session.isActive(this.now())) {
      throw new SessionNotFoundError();
    }
    await this.sessions.revoke(session, REVOKE_REASONS.USER);
  }
}
