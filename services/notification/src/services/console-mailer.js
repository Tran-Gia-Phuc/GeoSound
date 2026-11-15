// =========================================================
// Mailer giả cho DEV của notification: không gửi mail thật, chỉ in ra console.
// Dùng khi chưa cấu hình SMTP (thiếu SMTP_HOST/SMTP_FROM) để test luồng event.
// API trùng createSmtpMailer: send({ to, subject, text, html }) -> { status }.
// =========================================================
export function createConsoleMailer(logger = console) {
  return {
    async send({ to, subject }) {
      logger.log(`[mail:dev] -> ${to} | ${subject}`);
      return { status: 'console_logged', messageId: undefined };
    },
    close() {},
  };
}
