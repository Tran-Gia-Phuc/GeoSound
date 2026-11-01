// =========================================================
// #265 — heartbeat of a signed-in device: keeps `lastActiveAt` fresh so the admin view can tell
// which devices are online. At most one write per `heartbeatMinSeconds` per session.
// A token without sid (old client) has no session to touch: nothing happens.
// =========================================================

export class SessionHeartbeat {
  /**
   * @param {{ sessionRepo: import('../../domain/ports/index.js').SessionRepository,
   *           policy: { heartbeatMinSeconds: number }, now?: () => Date }} deps
   */
  constructor({ sessionRepo, policy, now }) {
    this.sessionRepo = sessionRepo;
    this.policy = policy;
    this.now = now ?? (() => new Date());
  }

  /** @param {{ currentSid?: string|null }} input @returns {Promise<{ touched: boolean }>} */
  async execute({ currentSid = null }) {
    if (!currentSid) return { touched: false };
    const now = this.now();
    const notAfter = new Date(now.getTime() - this.policy.heartbeatMinSeconds * 1000);
    return { touched: await this.sessionRepo.touch(currentSid, now, notAfter) };
  }
}
