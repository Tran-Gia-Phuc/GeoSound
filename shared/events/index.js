// =========================================================
// Event contract dùng chung (RabbitMQ).
// Tên event + payload schema (zod) — xem tech-stack.md §6.
// Mọi service publish/consume PHẢI validate payload qua đây.
// =========================================================
import { z } from 'zod';

// --- Tên event (routing key) ---
export const EVENTS = {
  PLACE_SUBMITTED: 'place.submitted',
  PLACE_AI_PASSED: 'place.ai_passed',
  PLACE_AI_REJECTED: 'place.ai_rejected',
  TOUR_SUBMITTED: 'tour.submitted',
  TOUR_AI_PASSED: 'tour.ai_passed',
  TOUR_AI_REJECTED: 'tour.ai_rejected',
  TOUR_APPROVED: 'tour.approved',
  TOUR_REJECTED: 'tour.rejected',
  TOUR_REPORTED: 'tour.reported',
  TOUR_HIDDEN: 'tour.hidden',
  TOUR_PUBLISHED: 'tour.published',
  TOUR_UNPUBLISHED: 'tour.unpublished',
  TTS_RENDER_REQUESTED: 'tts.render.requested',
  TTS_RENDER_COMPLETED: 'tts.render.completed',
};

// --- Payload schema (zod). Chi tiết sẽ bổ sung khi chốt data model (tech-stack.md §11). ---
const base = z.object({
  tourId: z.string().min(1),
  at: z.string().datetime().optional(),
});

// Thông tin người nhận để service notification gửi email/in-app (UC16).
// Optional: publisher cấp khi có; thiếu thì notification bỏ qua việc gửi email.
const recipient = {
  contributorId: z.string().min(1).optional(),
  contributorEmail: z.string().email().optional(),
  tourTitle: z.string().min(1).optional(),
};

// --- Reusable moderation schemas (camelCase). See docs/02-design/moderation-architecture.md §6.1. ---

// ISO 8601 UTC timestamp; zod's default rejects offsets, so the string must end with `Z`.
export const isoUtc = z.string().datetime();

export const MODERATION_CATEGORIES = [
  'hate', 'violence', 'sexual', 'scam', 'misleading', 'irrelevant', 'other', 'route',
];

// One moderation finding. `source` tells whether it comes from the AI or from Moderation's geo rules.
export const reasonSchema = z.object({
  field: z.string().min(1).max(100),
  category: z.enum(MODERATION_CATEGORIES),
  message: z.string().min(1).max(500),
  source: z.enum(['ai', 'geo']),
  severity: z.number().min(0).max(1).optional(),
});

export const imageSchema = z.object({
  url: z.string().url(),
  caption: z.string().max(300).optional(),
});

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const severity = z.number().min(0).max(1);
const reasons = z.array(reasonSchema).max(50);

// Keys shared by place.ai_passed and place.ai_rejected.
const placeResult = {
  placeId: z.string().min(1),
  tourId: z.string().min(1),
  revision: isoUtc,
  at: isoUtc.optional(),
};

// Place summary carried inside tour.submitted (the tour scan does not rescan places).
const tourPlace = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1).max(200),
  type: z.string().optional(),
  description: z.string().max(2000),
  lat,
  lng,
  sequence: z.number().int().nonnegative(),
});

// --- Chatbot index events (Tour -> AI indexer). See docs/02-design/ai-integration-requests.md section 2. ---

export const UNPUBLISH_REASONS = ['unpublished', 'edited', 'hidden', 'restricted', 'deleted'];

const placeTranslation = z.object({
  language: z.string().min(2).max(10),
  text: z.string().max(5000),
});

// Public place content carried by tour.published.
const publishedPlace = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1).max(200),
  type: z.string().optional(),
  description: z.string().max(2000),
  lat,
  lng,
  sequence: z.number().int().nonnegative(),
  translations: z.array(placeTranslation).optional(),
});

export const schemas = {
  [EVENTS.PLACE_SUBMITTED]: z.object({
    placeId: z.string().min(1),
    tourId: z.string().min(1),
    contributorId: z.string().min(1),
    revision: isoUtc,
    name: z.string().min(1).max(200),
    type: z.string().optional(),
    description: z.string().min(1).max(2000),
    language: z.string().min(2).max(10),
    lat,
    lng,
    city: z.string().optional(),
    images: z.array(imageSchema).max(5).optional(),
    at: isoUtc.optional(),
  }),
  [EVENTS.PLACE_AI_PASSED]: z.object({
    ...placeResult,
    warning: z.boolean().optional(),
    severity: severity.optional(),
    reasons: reasons.optional(),
  }),
  [EVENTS.PLACE_AI_REJECTED]: z.object({
    ...placeResult,
    reason: z.string().min(1).max(1000),
    reasons: reasons.optional(),
  }),
  // Old keys unchanged; new content keys are optional so existing publishers keep working.
  [EVENTS.TOUR_SUBMITTED]: base.extend({
    contributorId: z.string().min(1),
    revision: isoUtc.optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    language: z.string().min(2).max(10).optional(),
    city: z.string().optional(),
    type: z.enum(['walking', 'driving', 'cycling', 'indoor']).optional(),
    durationMinutes: z.number().int().nonnegative().optional(),
    places: z.array(tourPlace).max(50).optional(),
  }),
  [EVENTS.TOUR_AI_PASSED]: base.extend({
    revision: isoUtc.optional(),
    warning: z.boolean().optional(),
    severity: severity.optional(),
    reasons: reasons.optional(),
    ...recipient,
  }),
  // `reason` stays a plain string: Notification depends on it.
  [EVENTS.TOUR_AI_REJECTED]: base.extend({
    reason: z.string(),
    ...recipient,
    revision: isoUtc.optional(),
    reasons: reasons.optional(),
  }),
  [EVENTS.TOUR_APPROVED]: base.extend({ adminId: z.string().min(1), ...recipient }),
  [EVENTS.TOUR_REJECTED]: base.extend({ reason: z.string(), ...recipient }),
  [EVENTS.TOUR_REPORTED]: base.extend({ count: z.number().int().nonnegative() }),
  [EVENTS.TOUR_HIDDEN]: base.extend({ reason: z.string(), ...recipient }),
  // Published by Tour only when a tour enters `public` (flag CHATBOT_EVENTS_ENABLED).
  [EVENTS.TOUR_PUBLISHED]: base.extend({
    revision: isoUtc,
    status: z.literal('public'),
    title: z.string().min(1).max(200),
    description: z.string().max(5000),
    language: z.string().min(2).max(10),
    city: z.string().optional(),
    type: z.enum(['walking', 'driving', 'cycling', 'indoor']),
    durationMinutes: z.number().int().nonnegative().optional(),
    languages: z.array(z.string().min(2).max(10)).optional(),
    places: z.array(publishedPlace).max(50),
  }),
  // A tour left `public`: the indexer deletes everything about it.
  [EVENTS.TOUR_UNPUBLISHED]: base.extend({
    revision: isoUtc.optional(),
    reason: z.enum(UNPUBLISH_REASONS),
  }),
  [EVENTS.TTS_RENDER_REQUESTED]: base.extend({ languages: z.array(z.string()).nonempty() }),
  [EVENTS.TTS_RENDER_COMPLETED]: base.extend({ assets: z.array(z.object({ lang: z.string(), url: z.string().url() })), ...recipient }),
};

/** Validate payload theo tên event; ném lỗi nếu sai schema. */
export function validateEvent(eventName, payload) {
  const schema = schemas[eventName];
  if (!schema) throw new Error(`Unknown event: ${eventName}`);
  return schema.parse(payload);
}
