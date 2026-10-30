// =========================================================
// Notification worker (UC16). KHÔNG mở port.
// Consume event kết quả -> gửi email báo contributor (kèm lý do nếu có).
// =========================================================
import { connect, consume } from '../shared/rabbitmq/index.js';
import { EVENTS } from '../shared/events/index.js';
import { createMailer } from './services/mailer.js';
import { handleEvent } from './notify.js';

async function main() {
  await connect();
  const mailer = createMailer();
  await consume(
    'notification.events',
    [
      EVENTS.TOUR_AI_REJECTED,
      EVENTS.TOUR_APPROVED,
      EVENTS.TOUR_REJECTED,
      EVENTS.TOUR_CHANGES_REQUESTED,
      EVENTS.TOUR_REPORTED,
      EVENTS.TOUR_HIDDEN,
      EVENTS.TTS_RENDER_COMPLETED,
    ],
    (event, payload) => handleEvent(mailer, event, payload),
  );
  console.log('[notification] worker started');
}

main().catch((err) => {
  console.error('[notification] fatal:', err.message);
  process.exit(1);
});
