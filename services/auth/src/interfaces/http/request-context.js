// =========================================================
// UC23 — what a sign-in or refresh needs to know about the device: User-Agent and IP.
// The IP is the first hop of x-forwarded-for (set by the gateway), else the socket address.
// It is only displayed approximately (R2) and used for location, never for access control.
// =========================================================

/** @param {import('express').Request} req */
export function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const first = String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '')
    .split(',')[0]
    .trim();
  const ip = first || req.ip || req.socket?.remoteAddress || null;
  if (!ip) return null;
  return String(ip).replace(/^::ffff:/, '').slice(0, 64);
}

/** @param {import('express').Request} req */
export function deviceContext(req) {
  const ua = req.headers?.['user-agent'];
  return { userAgent: ua ? String(ua) : null, ip: clientIp(req) };
}

/** Signed-in user from verifyJwt (req.user): id + current session id (absent on old tokens). */
export function currentUser(req) {
  return { userId: req.user?.sub, currentSid: req.user?.sid ?? null };
}
