// =========================================================
// Media worker (UC12 + TTS của UC03). KHÔNG mở port.
// Skeleton: consume tts.render.requested / tour.approved -> (sẽ) render TTS -> S3.
// =========================================================
import { connect, consume, publish } from '../shared/rabbitmq/index.js';
import { EVENTS } from '../shared/events/index.js';

async function main() {
  await connect();
  await consume(
    'media.tts-render',
    [EVENTS.TTS_RENDER_REQUESTED, EVENTS.TOUR_APPROVED],
    async (event, payload) => {
      console.log(`[media] got ${event}:`, payload);
      // TODO(UC12): Google Translate + TTS -> .mp3 -> upload S3
      //   rồi publish tts.render.completed với danh sách asset.
      //   (publish đã import sẵn để dùng ở bước sau)
      void publish;
    }
  );
  console.log('[media] worker started');
}

main().catch((err) => {
  console.error('[media] fatal:', err.message);
  process.exit(1);
});
