// =========================================================
// Guard for service-to-service routes (#258): header x-internal-token = INTERNAL_SERVICE_TOKEN.
// - no token configured -> the routes are off (404), so nothing is open by mistake;
// - a request forwarded by the gateway (x-forwarded-for, gateway uses xfwd) is refused (404):
//   these routes are reachable only inside the Docker network;
// - constant-time compare, 401 on a wrong or missing token.
// =========================================================
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(String(value)).digest();

/** @param {string|undefined|null} expectedToken */
export function requireInternalToken(expectedToken) {
  const expected = String(expectedToken ?? '').trim();
  const expectedDigest = expected ? digest(expected) : null;
  return (req, res, next) => {
    if (!expectedDigest || req.headers['x-forwarded-for']) return res.status(404).json({ error: 'Not found' });
    const given = req.headers['x-internal-token'];
    if (typeof given !== 'string' || !timingSafeEqual(digest(given), expectedDigest)) {
      return res.status(401).json({ error: 'Invalid internal token', code: 'invalid_internal_token' });
    }
    next();
  };
}
