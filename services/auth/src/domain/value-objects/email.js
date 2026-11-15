// =========================================================
// Value Object: Email. Chuẩn hóa (trim + lowercase) và kiểm định dạng (E5).
// Thuần domain — không phụ thuộc framework.
// =========================================================
import { ValidationError } from '../errors/index.js';

// RFC 5322 rút gọn, đủ dùng cho form đăng ký/đăng nhập.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
  /** @param {string} value */
  constructor(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) throw new ValidationError('Vui lòng nhập email');
    if (!EMAIL_RE.test(normalized)) throw new ValidationError('Email không hợp lệ');
    this.value = normalized;
  }

  toString() {
    return this.value;
  }
}
