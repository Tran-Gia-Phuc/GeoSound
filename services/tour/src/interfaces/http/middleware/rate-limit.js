// =========================================================
// Small in-memory rate limiter (fixed window per client IP). Used by the routes that can call the
// AI service for an anonymous visitor (POST .../translations/:lang, UC04 / UC12): the Gemini free
// tier is shared with moderation and the chatbot. One Tour instance, so memory is enough.
// Client IP: first x-forwarded-for entry (the gateway mounts /api/tours with xfwd), else req.ip.
// =========================================================

/** @param {import('express').Request} req */
export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.ip || 'unknown';
}

/**
 * @param {{ max: number, windowMs: number, now?: () => number,
 *           message?: string }} opts
 * @returns {import('express').RequestHandler}
 */
export function rateLimit({ max, windowMs, now = Date.now, message = 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút' }) {
  const hits = new Map(); // ip -> { start, count }
  return (req, res, next) => {
    const t = now();
    const ip = clientIp(req);
    let entry = hits.get(ip);
    if (!entry || t - entry.start >= windowMs) {
      entry = { start: t, count: 0 };
      hits.set(ip, entry);
      // Drop finished windows now and then so the map stays small.
      if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.start + windowMs - t) / 1000)));
      return res.status(429).json({ error: message, code: 'rate_limited' });
    }
    return next();
  };
}
