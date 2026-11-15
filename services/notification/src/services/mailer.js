// =========================================================
// Factory chọn mailer theo cấu hình:
//   - có SMTP_HOST + SMTP_FROM  -> createSmtpMailer (gửi thật)
//   - thiếu                      -> createConsoleMailer (dev, chỉ log)
// =========================================================
import { createSmtpMailer } from './smtp-mailer.js';
import { createConsoleMailer } from './console-mailer.js';

export function createMailer(env = process.env, logger = console) {
  if (env.SMTP_HOST && env.SMTP_FROM) return createSmtpMailer(env);
  logger.warn('[notification] SMTP chưa cấu hình (thiếu SMTP_HOST/SMTP_FROM) -> dùng console mailer (dev).');
  return createConsoleMailer(logger);
}
