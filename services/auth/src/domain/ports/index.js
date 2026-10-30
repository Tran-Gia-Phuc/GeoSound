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
 * @property {(user: import('../entities/user.js').User, opts?: { sid?: string }) => { accessToken: string, refreshToken: string, expiresIn: string }} issueTokens
 *   // with `sid` (UC23): access token carries `sid`, refresh token carries `sub`, `sid` and a random `jti`
 * @property {(refreshToken: string) => { sub: string, sid?: string }} verifyRefresh
 * @property {(refreshToken: string) => string} hashRefresh  // sha-256 hex, stored in the session (R11)
 */

/**
 * UC23 — signed-in device sessions (schema auth, table sessions).
 * @typedef {Object} SessionRepository
 * @property {(session: import('../entities/session.js').Session) => Promise<import('../entities/session.js').Session>} create
 * @property {(session: import('../entities/session.js').Session) => Promise<import('../entities/session.js').Session>} save
 * @property {(id: string) => Promise<import('../entities/session.js').Session|null>} findById
 * @property {(userId: string, deviceId: string) => Promise<import('../entities/session.js').Session|null>} findLatestByDevice  // any state, newest first
 * @property {(userId: string, now: Date) => Promise<import('../entities/session.js').Session[]>} listActiveByUser  // not revoked, not expired
 * @property {(cutoff: Date) => Promise<number>} deleteEndedBefore  // revoked or expired before cutoff (R12)
 */

/**
 * UC23 / 5.3 — makes a sign-out immediate: services reject access tokens whose `sid` is marked.
 * @typedef {Object} RevocationStore
 * @property {(sid: string) => Promise<void>} markRevoked
 */

/**
 * UC23 / R12 — approximate location (city, country) from an IP; null when unknown.
 * @typedef {Object} LocationResolver
 * @property {(ip: string|null) => Promise<string|null>} resolve
 */

/**
 * Publishes a domain event (RabbitMQ in production). Payload validated against shared/events.
 * @typedef {Object} EventPublisher
 * @property {(eventName: string, payload: object) => Promise<void>} publish
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
