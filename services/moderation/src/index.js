// =========================================================
// Moderation service (UC15,19,06,20,22).
// Skeleton: express /health + consumer RabbitMQ (tour.submitted).
// Pipeline AI (Gemini) + state machine thật thêm sau.
// =========================================================
import express from 'express';
import { logger, errorHandler } from '../shared/middleware/index.js';
import { connect, consume } from '../shared/rabbitmq/index.js';
import { EVENTS } from '../shared/events/index.js';

const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());
app.use(logger);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'moderation' }));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(PORT, () => console.log(`[moderation] listening on :${PORT}`));

// --- Consumer: nhận tour.submitted -> (sẽ) chạy AI Tầng 1 (Gemini) ---
(async () => {
  try {
    await connect();
    await consume('moderation.tour-submitted', [EVENTS.TOUR_SUBMITTED], async (event, payload) => {
      console.log(`[moderation] got ${event}:`, payload);
      // TODO(UC15): Gemini text + NSFW + turf.js -> publish tour.ai_passed / tour.ai_rejected
    });
  } catch (err) {
    console.error('[moderation] rabbitmq init failed:', err.message);
  }
})();
