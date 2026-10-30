// =========================================================
// Middleware dùng chung: verifyJwt, errorHandler, logger.
// =========================================================
import jwt from 'jsonwebtoken';

/** Log gọn mỗi request. */
export function logger(req, _res, next) {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
}

// UC23 / design 5.3 — optional check "is this session signed out?", set once per service in
// src/index.js. Null = no check (tokens are verified by signature and role only, as before).
let sessionRevocationCheck = null;
let revocationWarned = false;

/**
 * Configure the session revocation check used by every verifyJwt() of this process.
 * @param {((sid: string) => Promise<boolean>)|null} fn
 */
export function setSessionRevocationCheck(fn) {
  sessionRevocationCheck = typeof fn === 'function' ? fn : null;
  revocationWarned = false;
}

export const SESSION_REVOKED_BODY = Object.freeze({
  error: 'Phiên đăng nhập đã kết thúc',
  code: 'session_revoked',
});

/**
 * Builds a revocation check from a Redis client (ioredis or anything with `get(key)`):
 * a sid is revoked when the key "revoked:sid:<sid>" exists (written by Auth on sign-out).
 * A slow Redis is cut after `timeoutMs` and then counts as an error (verifyJwt fails open).
 * @param {{ get: (key: string) => Promise<string|null> }} redis
 */
export function createRedisRevocationCheck(redis, { prefix = 'revoked:sid:', timeoutMs = 300 } = {}) {
  return async (sid) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('revocation check timeout')), timeoutMs);
    });
    try {
      const value = await Promise.race([redis.get(`${prefix}${sid}`), timeout]);
      return value !== null && value !== undefined;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Verify access token (Bearer). Gắn req.user = payload.
 * `roles` (tùy chọn): giới hạn vai trò (tourist | contributor | admin).
 * `options.isRevoked` (tùy chọn): overrides the check set with setSessionRevocationCheck.
 * UC23: a token with `sid` whose session is signed out -> 401 session_revoked. When the check
 * itself fails (e.g. Redis down) the request goes through (fail open, warned once) so a cache
 * outage never takes the API down; tokens without `sid` (before UC23) are never checked.
 */
export function verifyJwt(roles = [], options = {}) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const accept = () => {
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = payload;
      next();
    };

    const isRevoked = options.isRevoked ?? sessionRevocationCheck;
    if (!payload.sid || !isRevoked) return accept();

    return Promise.resolve()
      .then(() => isRevoked(payload.sid))
      .catch((err) => {
        if (!revocationWarned) {
          revocationWarned = true;
          console.warn(`[auth] session revocation check failed, allowing the request: ${err?.message}`);
        }
        return false;
      })
      .then((revoked) => (revoked ? res.status(401).json({ ...SESSION_REVOKED_BODY }) : accept()))
      .catch(next);
  };
}

/**
 * Error handler cuối chuỗi middleware.
 * Lỗi nghiệp vụ (4xx) trả thêm `code` + dữ liệu chỉ chỗ cần sửa (`details` theo
 * trường, `missing`, `zone`) để client dẫn người dùng tới đúng bước. Lỗi 5xx chỉ
 * trả message — không lộ code nội bộ (vd ECONNREFUSED).
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  console.error('[error]', err);
  const status = err.status || 500;
  const body = { error: err.message || 'Internal Server Error' };
  if (status < 500) {
    if (err.code) body.code = err.code;
    if (err.details) body.details = err.details;
    if (err.missing) body.missing = err.missing;
    if (err.zone) body.zone = err.zone;
  }
  res.status(status).json(body);
}
