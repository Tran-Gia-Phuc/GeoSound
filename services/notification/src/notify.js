// =========================================================
// Logic xử lý 1 event -> gửi email cho contributor (UC16).
// UC23 / R10: auth.new_device_login -> security email to the account owner, or to
// SECURITY_ALERT_TO when set (demo inbox, configured only in .env).
// Tách khỏi index.js (không import shared/) để unit-test được cục bộ.
// =========================================================
import { buildTourEmail } from './services/tour-email-template.js';
import { buildNewDeviceEmail, NEW_DEVICE_LOGIN } from './services/security-email-template.js';

/** Recipient of a security alert: the demo override when configured, else the account email. */
export function securityAlertRecipient(payload = {}, env = process.env) {
  const override = String(env.SECURITY_ALERT_TO ?? '').trim();
  return override || payload.email || null;
}

async function handleNewDeviceLogin(mailer, payload, logger, env) {
  const to = securityAlertRecipient(payload, env);
  if (!to) {
    logger.warn(`[notification] ${NEW_DEVICE_LOGIN} thiếu email (userId=${payload.userId}) -> không gửi được email.`);
    return { skipped: 'no_recipient' };
  }
  const result = await mailer.send({ to, ...buildNewDeviceEmail(payload) });
  logger.log(`[notification] email "${NEW_DEVICE_LOGIN}" (userId=${payload.userId}): ${result.status}`);
  return { sent: result };
}

export async function handleEvent(mailer, event, payload = {}, logger = console, env = process.env) {
  if (event === NEW_DEVICE_LOGIN) return handleNewDeviceLogin(mailer, payload, logger, env);

  const email = buildTourEmail({ event, payload });
  if (!email) {
    logger.log(`[notification] ${event}: không có mẫu email cho contributor, bỏ qua.`);
    return { skipped: 'no_template' };
  }
  const to = payload.contributorEmail;
  if (!to) {
    logger.warn(`[notification] ${event} thiếu contributorEmail (tourId=${payload.tourId}) -> không gửi được email.`);
    return { skipped: 'no_recipient' };
  }
  const result = await mailer.send({ to, ...email });
  logger.log(`[notification] email "${event}" -> ${to}: ${result.status}`);
  // TODO(UC16): tạo thêm thông báo in-app (bảng notifications qua Prisma).
  //   Trước khi import PrismaClient, bổ sung `RUN npx prisma generate` trong Dockerfile.
  return { sent: result };
}
