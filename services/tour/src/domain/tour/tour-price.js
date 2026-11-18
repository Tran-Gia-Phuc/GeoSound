// =========================================================
// UC25 (#446) — paid offline package: price rules, purchase states, MoMo result codes. Pure.
// =========================================================
import { ValidationError } from '../errors/index.js';

// MoMo accepts 1 000 to 50 000 000 VND per order; 0 = free tour.
export const PRICE_MIN = 1000;
export const PRICE_MAX = 50_000_000;

export const PURCHASE_STATUS = Object.freeze({ PENDING: 'pending', PAID: 'paid', FAILED: 'failed' });

/** @returns {number} a valid price (integer VND) or throws ValidationError (400). */
export function normalizePrice(value) {
  if (!Number.isInteger(value)) throw new ValidationError('Giá phải là số nguyên (VND)');
  if (value !== 0 && (value < PRICE_MIN || value > PRICE_MAX)) {
    throw new ValidationError('Giá phải bằng 0 (miễn phí) hoặc từ 1.000 đến 50.000.000 VND');
  }
  return value;
}

export const isPaidTour = (tour) => (tour?.price ?? 0) > 0;

// 1000 = waiting for the user, 7000 / 7002 = processing, 9000 = authorised, not captured yet.
const MOMO_PENDING = new Set([1000, 7000, 7002, 9000]);

/** MoMo resultCode -> purchase status. */
export function momoResultStatus(resultCode) {
  const code = Number(resultCode);
  if (code === 0) return PURCHASE_STATUS.PAID;
  if (MOMO_PENDING.has(code)) return PURCHASE_STATUS.PENDING;
  return PURCHASE_STATUS.FAILED;
}
