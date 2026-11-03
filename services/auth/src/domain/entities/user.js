// =========================================================
// Entity: User. Giữ trạng thái + quy tắc nghiệp vụ liên quan đăng nhập:
//   - ban (UC21): isBanned()
//   - UC21 suspension with an end date: isSuspended(now), effectiveStatus(now), isRestricted(now);
//     a suspension whose end passed counts as active (checked lazily, nothing rewrites the row)
//   - UC21 admin transitions: suspended(), banned(), restored() return the next state
//   - tạm khóa khi sai mật khẩu nhiều lần (E2): isLocked(), registerFailedLogin(), resetLockout()
// Thuần domain: không biết Prisma/HTTP. Repo map DB row <-> entity này.
// =========================================================

export const ROLES = Object.freeze({
  TOURIST: 'tourist',
  CONTRIBUTOR: 'contributor',
  ADMIN: 'admin',
});

// Vai trò người dùng được tự chọn khi đăng ký (Admin KHÔNG tự đăng ký).
export const SELF_REGISTER_ROLES = Object.freeze([ROLES.TOURIST, ROLES.CONTRIBUTOR]);

export const USER_STATUS = Object.freeze({ ACTIVE: 'active', SUSPENDED: 'suspended', BANNED: 'banned' });

export class User {
  /**
   * @param {{
   *   id?: string, email: string, passwordHash: string, fullName: string,
   *   role?: string, status?: string, banReason?: string|null, suspendedUntil?: Date|null,
   *   failedAttempts?: number, lockedUntil?: Date|null,
   *   createdAt?: Date, updatedAt?: Date,
   * }} props
   */
  constructor(props) {
    this.id = props.id ?? null;
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.fullName = props.fullName;
    this.role = props.role ?? ROLES.TOURIST;
    this.status = props.status ?? USER_STATUS.ACTIVE;
    this.banReason = props.banReason ?? null;
    this.suspendedUntil = props.suspendedUntil ?? null;
    this.failedAttempts = props.failedAttempts ?? 0;
    this.lockedUntil = props.lockedUntil ?? null;
    this.createdAt = props.createdAt ?? null;
    this.updatedAt = props.updatedAt ?? null;
  }

  isBanned() {
    return this.status === USER_STATUS.BANNED;
  }

  /** UC21 — suspended and the end date has not passed (no end date = still suspended). */
  isSuspended(now = new Date()) {
    if (this.status !== USER_STATUS.SUSPENDED) return false;
    if (!(this.suspendedUntil instanceof Date)) return true;
    return this.suspendedUntil.getTime() > now.getTime();
  }

  /** UC21 — status as the rest of the system sees it: an expired suspension reads `active`. */
  effectiveStatus(now = new Date()) {
    if (this.isBanned()) return USER_STATUS.BANNED;
    if (this.isSuspended(now)) return USER_STATUS.SUSPENDED;
    return USER_STATUS.ACTIVE;
  }

  /** UC21 — banned or currently suspended. */
  isRestricted(now = new Date()) {
    return this.effectiveStatus(now) !== USER_STATUS.ACTIVE;
  }

  /** The stored state an admin action reads; used as the condition of the write (race guard). */
  stateSnapshot() {
    return { status: this.status, suspendedUntil: this.suspendedUntil };
  }

  /** UC21 — next state of a suspension until `until`. */
  static suspended(reason, until) {
    return { status: USER_STATUS.SUSPENDED, banReason: reason, suspendedUntil: until };
  }

  /** UC21 — next state of a ban (no end date). */
  static banned(reason) {
    return { status: USER_STATUS.BANNED, banReason: reason, suspendedUntil: null };
  }

  /** UC21 — back to active; the restriction reason is cleared. */
  static restored() {
    return { status: USER_STATUS.ACTIVE, banReason: null, suspendedUntil: null };
  }

  /** UC21 — admin list / detail item: never the hash, OTP or sign-in lock data. */
  toAdminView(now = new Date()) {
    const status = this.effectiveStatus(now);
    return {
      id: this.id,
      email: this.email,
      fullName: this.fullName,
      role: this.role,
      status,
      banReason: status === USER_STATUS.ACTIVE ? null : this.banReason,
      suspendedUntil: status === USER_STATUS.SUSPENDED ? this.suspendedUntil : null,
      createdAt: this.createdAt,
    };
  }

  /** @param {Date} now */
  isLocked(now = new Date()) {
    return this.lockedUntil instanceof Date && this.lockedUntil.getTime() > now.getTime();
  }

  /**
   * Ghi nhận 1 lần đăng nhập sai. Đủ ngưỡng → đặt lockedUntil.
   * @param {{ maxAttempts: number, lockMs: number, now?: Date }} policy
   */
  registerFailedLogin({ maxAttempts, lockMs, now = new Date() }) {
    this.failedAttempts += 1;
    if (this.failedAttempts >= maxAttempts) {
      this.lockedUntil = new Date(now.getTime() + lockMs);
      this.failedAttempts = 0; // reset bộ đếm sau khi đã khóa
    }
  }

  /** Đăng nhập đúng → xóa bộ đếm & khóa. */
  resetLockout() {
    this.failedAttempts = 0;
    this.lockedUntil = null;
  }

  /** Payload nhúng vào JWT. */
  // `name` (UC05, #267): display name shown with a tour rating; other services ignore it.
  toAuthPayload() {
    return { sub: this.id, email: this.email, role: this.role, name: this.fullName };
  }

  /** Dữ liệu an toàn trả về client (không lộ hash). */
  toPublic() {
    return { id: this.id, email: this.email, fullName: this.fullName, role: this.role };
  }
}
