// =========================================================
// Mailer giả cho DEV: không gửi mail thật, chỉ in OTP ra console.
// Dùng khi chưa cấu hình SMTP (SMTP_USER rỗng) để test luồng đăng ký/OTP.
// =========================================================

/** @implements {import('../../domain/ports/index.js').Mailer} */
export class ConsoleMailer {
  async sendOtp(to, code, purpose) {
    console.log(`[mail:dev] OTP (${purpose}) cho ${to} = ${code}`);
  }
}
