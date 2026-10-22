// =========================================================
// Entity: User. Giữ trạng thái + quy tắc nghiệp vụ liên quan đăng nhập:
//   - ban (UC21): isBanned()
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

export const USER_STATUS = Object.freeze({ ACTIVE: 'active', BANNED: 'banned' });

export class User {
  /**
   * @param {{
   *   id?: string, email: string, passwordHash: string, fullName: string,
   *   role?: string, status?: string, banReason?: string|null,
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
    this.failedAttempts = props.failedAttempts ?? 0;
    this.lockedUntil = props.lockedUntil ?? null;
    this.createdAt = props.createdAt ?? null;
    this.updatedAt = props.updatedAt ?? null;
  }

  isBanned() {
    return this.status === USER_STATUS.BANNED;
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
  toAuthPayload() {
    return { sub: this.id, email: this.email, role: this.role };
  }

  /** Dữ liệu an toàn trả về client (không lộ hash). */
  toPublic() {
    return { id: this.id, email: this.email, fullName: this.fullName, role: this.role };
  }
}
