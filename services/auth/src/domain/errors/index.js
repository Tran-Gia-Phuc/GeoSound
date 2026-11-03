// =========================================================
// Domain errors (auth). Mỗi lỗi mang sẵn `status` (HTTP) + `code` (máy đọc).
// Tầng interfaces (errorHandler) chỉ cần đọc err.status để trả response.
// Ánh xạ với Exception Path của UC01: E1..E8.
// =========================================================

export class AppError extends Error {
  /** @param {string} message @param {{ status?: number, code?: string }} [opts] */
  constructor(message, { status = 400, code = 'bad_request' } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

// E1, E4, E5, E6 — dữ liệu nhập không hợp lệ.
export class ValidationError extends AppError {
  /** @param {string} message @param {Record<string,string>} [details] */
  constructor(message, details) {
    super(message, { status: 400, code: 'validation_error' });
    if (details) this.details = details;
  }
}

// E2 — email/mật khẩu sai.
export class InvalidCredentialsError extends AppError {
  constructor(message = 'Email hoặc mật khẩu không đúng') {
    super(message, { status: 401, code: 'invalid_credentials' });
  }
}

// E2 (nâng cao) — sai quá số lần cho phép → tạm khóa.
export class AccountLockedError extends AppError {
  /** @param {Date} until */
  constructor(until) {
    super('Tài khoản tạm khóa do đăng nhập sai nhiều lần, vui lòng thử lại sau', {
      status: 423,
      code: 'account_locked',
    });
    this.lockedUntil = until;
  }
}

// E3 — tài khoản bị ban (UC21).
export class AccountBannedError extends AppError {
  /** @param {string|null} [reason] */
  constructor(reason) {
    super('Tài khoản đã bị khóa, vui lòng liên hệ Admin', { status: 403, code: 'account_banned' });
    if (reason) this.reason = reason;
  }
}

/** "14:05 30/10/2026" in Vietnam time (UTC+7, no DST), by hand so it does not depend on ICU. */
export function formatVietnamTime(date) {
  const d = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// UC21 — suspended by an admin until a date. The shared errorHandler forwards `details`, so the
// end date reaches the client as details.suspendedUntil (ISO).
export class AccountSuspendedError extends AppError {
  /** @param {Date|null} until */
  constructor(until) {
    const when = until instanceof Date ? formatVietnamTime(until) : 'khi có thông báo mới';
    super(`Tài khoản đang bị tạm khoá đến ${when}`, { status: 403, code: 'account_suspended' });
    this.suspendedUntil = until ?? null;
    this.details = { suspendedUntil: until instanceof Date ? until.toISOString() : null };
  }
}

// UC21 / E1 — admin opened an unknown account.
export class AccountNotFoundError extends AppError {
  constructor(message = 'Không tìm thấy tài khoản') {
    super(message, { status: 404, code: 'user_not_found' });
  }
}

// UC21 — an admin never acts on their own account.
export class SelfActionError extends AppError {
  constructor(message = 'Không thể xử lý chính tài khoản của bạn') {
    super(message, { status: 403, code: 'self_action' });
  }
}

// UC21 — an admin never acts on another admin.
export class TargetIsAdminError extends AppError {
  constructor(message = 'Không thể xử lý tài khoản quản trị viên') {
    super(message, { status: 403, code: 'target_is_admin' });
  }
}

// UC21 / A1 — restore of an account that is already active (or whose suspension already ended).
export class AccountNotRestrictedError extends AppError {
  constructor(message = 'Tài khoản đang hoạt động bình thường') {
    super(message, { status: 409, code: 'account_not_restricted' });
  }
}

// UC21 — warn / suspend / ban of an account that is already banned (restore it first).
export class AccountAlreadyBannedError extends AppError {
  constructor(message = 'Tài khoản đã bị cấm vĩnh viễn') {
    super(message, { status: 409, code: 'account_already_banned' });
  }
}

// UC21 — another admin changed the account between the read and the write (conditional write lost).
export class AccountStateChangedError extends AppError {
  constructor(message = 'Trạng thái tài khoản vừa được thay đổi, vui lòng tải lại') {
    super(message, { status: 409, code: 'account_state_changed' });
  }
}

// UC21 / L13 — suspension end date in the past or more than 365 days ahead (422 like UC19).
export class InvalidSuspensionError extends AppError {
  constructor(message = 'Thời hạn tạm khoá không hợp lệ') {
    super(message, { status: 422, code: 'validation_error' });
  }
}

// UC23 / R7 — wrong current password on a password change (400, not 401: the token itself is valid).
export class WrongPasswordError extends AppError {
  constructor(message = 'Mật khẩu hiện tại không đúng') {
    super(message, { status: 400, code: 'wrong_password' });
  }
}

// E7 — email đã tồn tại.
export class EmailAlreadyExistsError extends AppError {
  constructor() {
    super('Tài khoản đã được đăng ký', { status: 409, code: 'email_exists' });
  }
}

// E8 — OTP sai hoặc hết hạn.
export class InvalidOtpError extends AppError {
  constructor(message = 'OTP không hợp lệ, vui lòng thử lại') {
    super(message, { status: 400, code: 'invalid_otp' });
  }
}

// Không tìm thấy phiên đăng ký/đặt lại (hết hạn trước khi nhập OTP).
export class ChallengeNotFoundError extends AppError {
  constructor(message = 'Phiên xác thực đã hết hạn, vui lòng thực hiện lại') {
    super(message, { status: 410, code: 'challenge_expired' });
  }
}

// Refresh token không hợp lệ/hết hạn.
export class InvalidTokenError extends AppError {
  constructor(message = 'Token không hợp lệ') {
    super(message, { status: 401, code: 'invalid_token' });
  }
}

// UC23 — the session behind a refresh token is signed out, expired or was reused (R6, R8, R11).
export class SessionRevokedError extends AppError {
  constructor(message = 'Phiên đăng nhập đã kết thúc') {
    super(message, { status: 401, code: 'session_revoked' });
  }
}

// UC23 — unknown session or one of another user (never tell which).
export class SessionNotFoundError extends AppError {
  constructor(message = 'Không tìm thấy phiên đăng nhập') {
    super(message, { status: 404, code: 'session_not_found' });
  }
}

// #258 — internal contact lookup of an unknown user.
export class UserNotFoundError extends AppError {
  constructor(message = 'Không tìm thấy người dùng') {
    super(message, { status: 404, code: 'user_not_found' });
  }
}

// UC18 — unknown account, not a contributor, or not active (banned / suspended): no author page.
export class AuthorNotFoundError extends AppError {
  constructor(message = 'Không tìm thấy tác giả') {
    super(message, { status: 404, code: 'author_not_found' });
  }
}

// UC18 — a user cannot follow their own author page.
export class SelfFollowError extends AppError {
  constructor(message = 'Bạn không thể tự theo dõi chính mình') {
    super(message, { status: 400, code: 'self_follow' });
  }
}

// UC23 / R4 — the current device signs out with "Đăng xuất", not from the device list.
export class CurrentSessionError extends AppError {
  constructor(message = 'Đây là thiết bị hiện tại, vui lòng dùng Đăng xuất') {
    super(message, { status: 409, code: 'current_session' });
  }
}
