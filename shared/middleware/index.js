// =========================================================
// Middleware dùng chung: verifyJwt, errorHandler, logger.
// =========================================================
import jwt from 'jsonwebtoken';

/** Log gọn mỗi request. */
export function logger(req, _res, next) {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
}

/**
 * Verify access token (Bearer). Gắn req.user = payload.
 * `roles` (tùy chọn): giới hạn vai trò (tourist | contributor | admin).
 */
export function verifyJwt(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try {
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

/** Error handler cuối chuỗi middleware. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
}
