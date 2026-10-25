// =========================================================
// Logic xử lý 1 event -> gửi email cho contributor (UC16).
// Tách khỏi index.js (không import shared/) để unit-test được cục bộ.
// =========================================================
import { buildTourEmail } from './services/tour-email-template.js';

export async function handleEvent(mailer, event, payload = {}, logger = console) {
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
