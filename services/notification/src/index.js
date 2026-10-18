// =========================================================
// Notification worker (UC16). KHÔNG mở port.
// Skeleton: consume các event kết quả -> (sẽ) báo contributor (in-app/email).
// =========================================================
import { connect, consume } from '../shared/rabbitmq/index.js';
import { EVENTS } from '../shared/events/index.js';

async function main() {
  await connect();
  await consume(
    'notification.events',
    [
      EVENTS.TOUR_AI_REJECTED,
      EVENTS.TOUR_APPROVED,
      EVENTS.TOUR_REJECTED,
      EVENTS.TOUR_REPORTED,
      EVENTS.TOUR_HIDDEN,
      EVENTS.TTS_RENDER_COMPLETED,
    ],
    async (event, payload) => {
      console.log(`[notification] got ${event}:`, payload);
      // TODO(UC16): tạo thông báo in-app + gửi email (Nodemailer) kèm lý do.
    }
  );
  console.log('[notification] worker started');
}

main().catch((err) => {
  console.error('[notification] fatal:', err.message);
  process.exit(1);
});
