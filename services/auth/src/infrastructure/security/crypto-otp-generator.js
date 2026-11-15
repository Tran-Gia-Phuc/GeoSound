// Impl của port OtpGenerator — sinh OTP 6 chữ số bằng crypto (an toàn hơn Math.random).
import { randomInt } from 'node:crypto';

/** @implements {import('../../domain/ports/index.js').OtpGenerator} */
export class CryptoOtpGenerator {
  /** @param {number} digits */
  constructor(digits = 6) {
    this.digits = digits;
  }

  generate() {
    const max = 10 ** this.digits;
    return String(randomInt(0, max)).padStart(this.digits, '0');
  }
}
