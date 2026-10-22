// =========================================================
// Value Object: Password (bản rõ, chỉ tồn tại thoáng qua trước khi hash).
// Business Rule UC01: tối thiểu 8 ký tự, gồm cả chữ và số (E6).
// =========================================================
import { ValidationError } from '../errors/index.js';

export const PASSWORD_MIN_LENGTH = 8;

export class Password {
  /** @param {string} value */
  constructor(value) {
    const raw = String(value ?? '');
    if (raw.length < PASSWORD_MIN_LENGTH) {
      throw new ValidationError(`Mật khẩu phải có tối thiểu ${PASSWORD_MIN_LENGTH} ký tự`);
    }
    if (!/[A-Za-z]/.test(raw) || !/[0-9]/.test(raw)) {
      throw new ValidationError('Mật khẩu phải gồm cả chữ và số');
    }
    this.value = raw;
  }

  toString() {
    return this.value;
  }
}
