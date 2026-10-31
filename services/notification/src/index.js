// =========================================================
// Notification worker (UC16). KHÔNG mở port.
// Consume event kết quả -> gửi email báo contributor (kèm lý do nếu có).
// UC23: auth.new_device_login -> security email ("Đăng nhập mới trên <thiết bị>").
// =========================================================
import { connect, consume } from '../shared/rabbitmq/index.js';
import { EVENTS } from '../shared/events/index.js';
import { createMailer } from './services/mailer.js';
import { handleEvent } from './notify.js';
import { contributorLookupFromEnv } from './services/contributor-lookup.js';

async function main() {
  await connect();
  const mailer = createMailer();
  // #258 — tour events carry only contributorId: the email is looked up in Auth.
  const lookupEmail = contributorLookupFromEnv();
  if (!lookupEmail) console.warn('[notification] AUTH_SERVICE_URL / INTERNAL_SERVICE_TOKEN missing: no contributor email lookup');
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
      EVENTS.AUTH_NEW_DEVICE_LOGIN, // UC23 / R10 — new-device sign-in alert
    ],
    (event, payload) => handleEvent(mailer, event, payload, console, process.env, { lookupEmail }),
  );
  console.log('[notification] worker started');
}

main().catch((err) => {
  console.error('[notification] fatal:', err.message);
  process.exit(1);
});
