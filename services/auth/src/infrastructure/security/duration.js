// =========================================================
// Parses a jsonwebtoken-style lifetime ("15m", "7d", "3600s", "2h") into seconds.
// Used for the TTL of the revocation key (= access token lifetime, design 5.3).
// A bare number string follows jsonwebtoken: milliseconds. Result is at least 1 second.
// =========================================================
const UNIT_SECONDS = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31557600 };

/** @param {string|number} value @param {number} fallbackSeconds */
export function durationToSeconds(value, fallbackSeconds = 900) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.ceil(value);
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?\s*$/i.exec(String(value ?? ''));
  if (!m) return fallbackSeconds;
  const n = Number(m[1]);
  const unit = m[2] ? m[2].toLowerCase() : 'ms';
  return Math.max(1, Math.ceil(n * UNIT_SECONDS[unit]));
}
