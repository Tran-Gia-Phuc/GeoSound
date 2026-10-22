// =========================================================
// Ports (hợp đồng mà application cần, infrastructure hiện thực).
// JS không có interface nên mô tả bằng JSDoc; container tiêm impl thật vào.
// Đây là "biên" của domain: use-case chỉ gọi các method dưới đây.
// =========================================================

/**
 * @typedef {Object} UserRepository
 * @property {(email: string) => Promise<import('../entities/user.js').User|null>} findByEmail
 * @property {(id: string) => Promise<import('../entities/user.js').User|null>} findById
 * @property {(user: import('../entities/user.js').User) => Promise<import('../entities/user.js').User>} create
 * @property {(user: import('../entities/user.js').User) => Promise<import('../entities/user.js').User>} save  // cập nhật lockout/ban
 */

/**
 * @typedef {Object} PasswordHasher
 * @property {(plain: string) => Promise<string>} hash
 * @property {(plain: string, hash: string) => Promise<boolean>} compare
 */

/**
 * @typedef {Object} TokenService
 * @property {(user: import('../entities/user.js').User) => { accessToken: string, refreshToken: string, expiresIn: string }} issueTokens
 * @property {(refreshToken: string) => { sub: string }} verifyRefresh
 */

/**
 * Lưu "thử thách" tạm thời trong Redis (TTL). kind: 'register' | 'reset'.
 * @typedef {Object} ChallengeStore
 * @property {(kind: string, email: string, payload: object, ttlSeconds: number) => Promise<void>} save
 * @property {(kind: string, email: string) => Promise<object|null>} get
 * @property {(kind: string, email: string) => Promise<void>} delete
 */

/**
 * @typedef {Object} OtpGenerator
 * @property {() => string} generate  // mã OTP (6 chữ số)
 */

/**
 * @typedef {Object} Mailer
 * @property {(to: string, code: string, purpose: 'register'|'reset') => Promise<void>} sendOtp
 */

export {};
