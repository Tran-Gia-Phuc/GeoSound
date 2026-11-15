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
 * @property {(user: import('../entities/user.js').User) => Promise<import('../entities/user.js').User>} save  // password, profile, lockout (never the UC21 status)
 * @property {(input: { q?: string, role?: string, status?: string, skip: number, take: number, now: Date }) => Promise<{ items: import('../entities/user.js').User[], total: number }>} search  // UC21 admin list, newest first
 * @property {(id: string, expected: { status: string, suspendedUntil: Date|null }, next: { status: string, banReason: string|null, suspendedUntil: Date|null }) => Promise<boolean>} updateStatusIf  // UC21 conditional write; false = state moved
 * @property {(id: string, fields: { fullName?: string, bio?: string|null, avatarUrl?: string|null }) => Promise<import('../entities/user.js').User|null>} updateProfile  // UC18: only the given profile fields; null = unknown id
 */

/**
 * UC18 — follows of contributors (schema auth, table author_follows). Follow / unfollow are
 * idempotent: the unique (followerId, authorId) pair decides, never a read-then-write.
 * @typedef {Object} FollowRepository
 * @property {(followerId: string, authorId: string) => Promise<void>} follow  // insert, nothing when the pair exists
 * @property {(followerId: string, authorId: string) => Promise<void>} unfollow  // delete, nothing when absent
 * @property {(followerId: string, authorId: string) => Promise<boolean>} isFollowing
 * @property {(authorId: string) => Promise<number>} countFollowers
 * @property {(authorIds: string[]) => Promise<Map<string, number>>} countFollowersMany  // one query for a page of authors
 * @property {(input: { followerId: string, skip: number, take: number, now: Date }) => Promise<{ items: Array<{ author: import('../entities/user.js').User, followedAt: Date }>, total: number }>} listFollowing  // active contributors only, newest follow first
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
 * @property {(id: string, now: Date, notAfter: Date) => Promise<boolean>} touch  // #265 heartbeat: lastActiveAt = now when active and lastActiveAt < notAfter
 * @property {(now: Date, onlineSince: Date) => Promise<{ devicesSeen: number, signedIn: number, online: number, onlineAccounts: number }>} countStats  // #265
 * @property {(now: Date, onlineSince: Date, limit: number) => Promise<Array<{ session: import('../entities/session.js').Session, user: { id: string, email: string, fullName: string, role: string } }>>} listOnline  // #265
 * @property {(now: Date, onlineSince: Date) => Promise<Array<string|null>>} listOnlineDeviceIds  // #329: deviceId of every online session (null for old clients)
 */

/**
 * #329 — presence of every visitor, signed in or not, by device id (Redis in production).
 * @typedef {Object} PresenceStore
 * @property {(deviceId: string, now: Date) => Promise<void>} touch  // seen now: online set + distinct devices of the day
 * @property {(deviceId: string) => Promise<void>} leave  // page closed: out of the online set at once
 * @property {(since: Date, knownDeviceIds: string[]) => Promise<{ total: number, known: number }>} countOnline  // known = how many of knownDeviceIds are online
 * @property {(now: Date, days: number[]) => Promise<number[]>} countActive  // distinct devices over the last N days, one result per entry of days
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
