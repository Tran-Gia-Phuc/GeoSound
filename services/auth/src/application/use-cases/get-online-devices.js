// =========================================================
// #265 — admin view of devices (UC23 R13): how many devices are known, signed in and online now,
// and which ones are online. "Online" = active session seen within `onlineWindowSeconds`
// (heartbeat, refresh or sign-in). Never returns the IP, user agent or refresh hash.
// #329 — visitors who are not signed in count too: the presence store (by device id) gives all
// online devices, the guests among them (online device ids without an online session) and the
// distinct devices seen today / in 7 / in 30 days. Presence counts are null when it is unavailable.
// =========================================================

export const ONLINE_LIST_LIMIT = 200;
export const ACTIVE_DAYS = [1, 7, 30];

const NO_PRESENCE = { onlineDevices: null, onlineGuests: null, activeToday: null, active7Days: null, active30Days: null };

export class GetOnlineDevices {
  /**
   * @param {{ sessionRepo: import('../../domain/ports/index.js').SessionRepository,
   *           presence?: import('../../domain/ports/index.js').PresenceStore|null,
   *           policy: { onlineWindowSeconds: number }, now?: () => Date }} deps
   */
  constructor({ sessionRepo, presence = null, policy, now }) {
    this.sessionRepo = sessionRepo;
    this.presence = presence;
    this.policy = policy;
    this.now = now ?? (() => new Date());
  }

  async execute() {
    const now = this.now();
    const onlineSince = new Date(now.getTime() - this.policy.onlineWindowSeconds * 1000);
    const [totals, rows, presence] = await Promise.all([
      this.sessionRepo.countStats(now, onlineSince),
      this.sessionRepo.listOnline(now, onlineSince, ONLINE_LIST_LIMIT),
      this.#presenceTotals(now, onlineSince),
    ]);
    return {
      at: now.toISOString(),
      onlineWindowSeconds: this.policy.onlineWindowSeconds,
      totals: { ...totals, ...presence },
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

  // A signed-in device counts once: its device id is both in a session and in the presence set.
  async #presenceTotals(now, onlineSince) {
    if (!this.presence) return NO_PRESENCE;
    try {
      const sessionDevices = await this.sessionRepo.listOnlineDeviceIds(now, onlineSince);
      const signedIn = new Set(sessionDevices.filter(Boolean));
      const withoutDevice = sessionDevices.length - sessionDevices.filter(Boolean).length; // old clients
      const [{ total, known }, [activeToday, active7Days, active30Days]] = await Promise.all([
        this.presence.countOnline(onlineSince, [...signedIn]),
        this.presence.countActive(now, ACTIVE_DAYS),
      ]);
      const onlineGuests = Math.max(0, total - known);
      return {
        onlineDevices: onlineGuests + signedIn.size + withoutDevice,
        onlineGuests,
        activeToday,
        active7Days,
        active30Days,
      };
    } catch {
      return NO_PRESENCE; // Redis down: the session counts still answer
    }
  }
}
