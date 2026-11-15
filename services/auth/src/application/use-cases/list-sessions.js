// =========================================================
// UC23 — "Thiết bị đang đăng nhập": active sessions of the signed-in user (R2, R3).
// Current device first, then the most recently active.
// =========================================================

export class ListSessions {
  /** @param {{ sessionRepo: import('../../domain/ports/index.js').SessionRepository, now?: () => Date }} deps */
  constructor({ sessionRepo, now }) {
    this.sessionRepo = sessionRepo;
    this.now = now ?? (() => new Date());
  }

  /** @param {{ userId: string, currentSid?: string|null }} input */
  async execute({ userId, currentSid = null }) {
    const active = await this.sessionRepo.listActiveByUser(userId, this.now());
    const sessions = active
      .map((s) => s.toPublic(currentSid))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt);
    return { sessions };
  }
}
