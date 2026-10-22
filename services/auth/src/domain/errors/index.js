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
