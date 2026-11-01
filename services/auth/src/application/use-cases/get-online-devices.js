// =========================================================
// #265 — admin view of devices (UC23 R13): how many devices are known, signed in and online now,
// and which ones are online. "Online" = active session seen within `onlineWindowSeconds`
// (heartbeat, refresh or sign-in). Never returns the IP, user agent or refresh hash.
// =========================================================

export const ONLINE_LIST_LIMIT = 200;

export class GetOnlineDevices {
  /**
   * @param {{ sessionRepo: import('../../domain/ports/index.js').SessionRepository,
   *           policy: { onlineWindowSeconds: number }, now?: () => Date }} deps
   */
  constructor({ sessionRepo, policy, now }) {
    this.sessionRepo = sessionRepo;
    this.policy = policy;
    this.now = now ?? (() => new Date());
  }

  async execute() {
    const now = this.now();
    const onlineSince = new Date(now.getTime() - this.policy.onlineWindowSeconds * 1000);
    const [totals, rows] = await Promise.all([
      this.sessionRepo.countStats(now, onlineSince),
      this.sessionRepo.listOnline(now, onlineSince, ONLINE_LIST_LIMIT),
    ]);
    return {
      at: now.toISOString(),
      onlineWindowSeconds: this.policy.onlineWindowSeconds,
      totals,
      online: rows.map(({ session, user }) => ({
        id: session.id,
        deviceName: session.deviceName,
        location: session.location,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        user: user ? { id: user.id, email: user.email, fullName: user.fullName, role: user.role } : null,
      })),
    };
  }
}
