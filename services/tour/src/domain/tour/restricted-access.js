// =========================================================
// UC14 (#269) — restricted access with a passcode: pure rules (docs/02-design/uc14-restricted-access.md).
//   - normalizePasscode: E1, 6..32 characters after trimming, no whitespace inside
//   - unlock rate limit: at most UNLOCK_MAX_FAILURES wrong attempts per account and tour in
//     UNLOCK_WINDOW_MS
//   - a grant is valid only for the passcode version it was made with (a new passcode or turning
//     restricted mode off bumps the version, so every older unlock stops working)
// =========================================================
import { ValidationError } from '../errors/index.js';

export const PASSCODE_MIN = 6;
export const PASSCODE_MAX = 32;
export const UNLOCK_MAX_FAILURES = 5;
export const UNLOCK_WINDOW_MS = 15 * 60 * 1000;

/**
 * E1 — returns the trimmed passcode or throws a ValidationError (400) with a Vietnamese message.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizePasscode(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw new ValidationError('Vui lòng nhập mã truy cập', { passcode: 'required' });
  if (/\s/.test(value)) {
    throw new ValidationError('Mã truy cập không được chứa khoảng trắng', { passcode: 'whitespace' });
  }
  if (value.length < PASSCODE_MIN || value.length > PASSCODE_MAX) {
    throw new ValidationError(`Mã truy cập phải từ ${PASSCODE_MIN} đến ${PASSCODE_MAX} ký tự`, { passcode: 'length' });
  }
  return value;
}

/** Start of the rate-limit window for `now`. */
export const unlockWindowStart = (now = new Date()) => new Date(now.getTime() - UNLOCK_WINDOW_MS);

/** A grant opens the tour only while its passcode version is the current one. */
export const isGrantValid = (grant, passcodeVersion) =>
  Boolean(grant) && grant.passcodeVersion === passcodeVersion;
