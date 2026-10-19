// =========================================================
// Event contract dùng chung (RabbitMQ).
// Tên event + payload schema (zod) — xem tech-stack.md §6.
// Mọi service publish/consume PHẢI validate payload qua đây.
// =========================================================
import { z } from 'zod';

// --- Tên event (routing key) ---
export const EVENTS = {
  TOUR_SUBMITTED: 'tour.submitted',
  TOUR_AI_PASSED: 'tour.ai_passed',
  TOUR_AI_REJECTED: 'tour.ai_rejected',
  TOUR_APPROVED: 'tour.approved',
  TOUR_REJECTED: 'tour.rejected',
  TOUR_REPORTED: 'tour.reported',
  TOUR_HIDDEN: 'tour.hidden',
  TTS_RENDER_REQUESTED: 'tts.render.requested',
  TTS_RENDER_COMPLETED: 'tts.render.completed',
};

// --- Payload schema (zod). Chi tiết sẽ bổ sung khi chốt data model (tech-stack.md §11). ---
const base = z.object({
  tourId: z.string().min(1),
  at: z.string().datetime().optional(),
});

export const schemas = {
  [EVENTS.TOUR_SUBMITTED]: base.extend({ contributorId: z.string().min(1) }),
  [EVENTS.TOUR_AI_PASSED]: base,
  [EVENTS.TOUR_AI_REJECTED]: base.extend({ reason: z.string() }),
  [EVENTS.TOUR_APPROVED]: base.extend({ adminId: z.string().min(1) }),
  [EVENTS.TOUR_REJECTED]: base.extend({ reason: z.string() }),
  [EVENTS.TOUR_REPORTED]: base.extend({ count: z.number().int().nonnegative() }),
  [EVENTS.TOUR_HIDDEN]: base.extend({ reason: z.string() }),
  [EVENTS.TTS_RENDER_REQUESTED]: base.extend({ languages: z.array(z.string()).nonempty() }),
  [EVENTS.TTS_RENDER_COMPLETED]: base.extend({ assets: z.array(z.object({ lang: z.string(), url: z.string().url() })) }),
};

/** Validate payload theo tên event; ném lỗi nếu sai schema. */
export function validateEvent(eventName, payload) {
  const schema = schemas[eventName];
  if (!schema) throw new Error(`Unknown event: ${eventName}`);
  return schema.parse(payload);
}
