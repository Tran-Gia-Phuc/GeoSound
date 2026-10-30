// =========================================================
// Entity: Session (UC23). One sign-in on one device (R1).
// Rules kept here (pure domain, no Prisma/HTTP):
//   - expiry: 7 days idle and 30 days absolute (R8) -> stored as `expiresAt`
//   - revoke: `revokedAt` + `revokeReason`
// See docs/02-design/device-sessions.md section 5.
// =========================================================

export const REVOKE_REASONS = Object.freeze({
  USER: 'user', // signed out one device, logout, or replaced by a new sign-in on the same device
  USER_ALL: 'user_all', // "sign out all other devices"
  PASSWORD_RESET: 'password_reset',
  PASSWORD_CHANGE: 'password_change',
  BANNED: 'banned',
  LIMIT: 'limit', // over AUTH_MAX_SESSIONS (R9)
  REUSE: 'reuse', // old refresh token presented again (R11)
  EXPIRED: 'expired',
});

const DAY_MS = 24 * 60 * 60 * 1000;

export class Session {
  /**
   * @param {{
   *   id: string, userId: string, deviceId?: string|null, deviceName: string,
   *   userAgent?: string|null, ipAddress?: string|null, location?: string|null,
   *   refreshHash: string, createdAt: Date, lastActiveAt: Date, expiresAt: Date,
   *   revokedAt?: Date|null, revokeReason?: string|null,
   * }} props
   */
  constructor(props) {
    this.id = props.id;
    this.userId = props.userId;
    this.deviceId = props.deviceId ?? null;
    this.deviceName = props.deviceName;
    this.userAgent = props.userAgent ?? null;
    this.ipAddress = props.ipAddress ?? null;
    this.location = props.location ?? null;
    this.refreshHash = props.refreshHash;
    this.createdAt = props.createdAt;
    this.lastActiveAt = props.lastActiveAt;
    this.expiresAt = props.expiresAt;
    this.revokedAt = props.revokedAt ?? null;
    this.revokeReason = props.revokeReason ?? null;
  }

  /**
   * New session at `now`.
   * @param {object} props same as the constructor without the dates
   * @param {{ idleDays: number, maxDays: number }} policy
   * @param {Date} now
   */
  static start(props, policy, now) {
    const s = new Session({ ...props, createdAt: now, lastActiveAt: now, expiresAt: now });
    s.expiresAt = Session.computeExpiry(s.createdAt, now, policy);
    return s;
  }

  /** Earliest of "idle limit after the last activity" and "absolute limit after sign-in" (R8). */
  static computeExpiry(createdAt, lastActiveAt, { idleDays, maxDays }) {
    const idle = lastActiveAt.getTime() + idleDays * DAY_MS;
    const absolute = createdAt.getTime() + maxDays * DAY_MS;
    return new Date(Math.min(idle, absolute));
  }

  isRevoked() {
    return this.revokedAt !== null;
  }

  /** @param {Date} now */
  isExpired(now) {
    return this.expiresAt.getTime() <= now.getTime();
  }

  /** @param {Date} now */
  isActive(now) {
    return !this.isRevoked() && !this.isExpired(now);
  }

  /** @param {string} reason one of REVOKE_REASONS @param {Date} now */
  revoke(reason, now) {
    if (this.isRevoked()) return;
    this.revokedAt = now;
    this.revokeReason = reason;
  }

  /**
   * Refresh rotation: new refresh hash, activity time, IP; expiry moves with activity (R8).
   * @param {{ refreshHash: string, ipAddress?: string|null, now: Date, policy: { idleDays: number, maxDays: number } }} p
   */
  touch({ refreshHash, ipAddress, now, policy }) {
    this.refreshHash = refreshHash;
    this.lastActiveAt = now;
    if (ipAddress) this.ipAddress = ipAddress;
    this.expiresAt = Session.computeExpiry(this.createdAt, now, policy);
  }

  /** Data shown in "Thiết bị đang đăng nhập" (R2): never the IP, User-Agent or token hash. */
  toPublic(currentSid) {
    return {
      id: this.id,
      deviceName: this.deviceName,
      location: this.location,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      current: this.id === currentSid,
    };
  }
}
