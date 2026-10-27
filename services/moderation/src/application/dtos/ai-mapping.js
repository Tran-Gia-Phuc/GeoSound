// Event payload (camelCase) <-> AI HTTP body (snake_case, same as /translate). Task #AI-34.
// This is the ONLY place that converts naming. It also truncates text to the AI limits (decision D9),
// so a valid event never turns into a 422 because of length.
//
// Choices:
// - Tour places keep up to 2000 characters of description (the contract limit). The AI cuts each one to
//   300 for the tour scan; it owns that cut, so the prompt rule lives in one place.
// - Missing optional keys are dropped (never sent as null). Missing required keys are not invented: the AI
//   answers 422 and the case goes to human review. Only `places` defaults to [] for a tour.
// - A 200 body with an unexpected shape is an AiTemporaryError (kind 'malformed'), so it is retried like a
//   provider hiccup instead of being published.
import { VERDICT } from '../../domain/entities/moderation-case.js';
import { AiTemporaryError } from '../../domain/errors/index.js';

export const AI_LIMITS = Object.freeze({
  title: 200,
  tourDescription: 5000,
  placeName: 200,
  placeDescription: 2000,
  places: 50,
  images: 5,
  imageCaption: 300,
  reasonMessage: 500,
});

const AI_CATEGORIES = new Set(['hate', 'violence', 'sexual', 'scam', 'misleading', 'irrelevant', 'other']);
const VERDICTS = new Set(Object.values(VERDICT));

// Cut by code points (Python counts code points), never splitting a surrogate pair.
export function truncate(value, max) {
  if (typeof value !== 'string') return value;
  if (value.length <= max) return value;
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** place.submitted payload -> POST /moderate/place body. */
export function toPlaceRequest(p) {
  return compact({
    place_id: p.placeId,
    tour_id: p.tourId,
    name: truncate(p.name, AI_LIMITS.placeName),
    type: p.type,
    description: truncate(p.description, AI_LIMITS.placeDescription),
    language: p.language,
    city: p.city,
    images: Array.isArray(p.images)
      ? p.images.slice(0, AI_LIMITS.images).map((img) => compact({
        url: img.url,
        caption: truncate(img.caption, AI_LIMITS.imageCaption),
      }))
      : undefined,
  });
}

/** tour.submitted payload -> POST /moderate/tour body. */
export function toTourRequest(t) {
  return compact({
    tour_id: t.tourId,
    title: truncate(t.title, AI_LIMITS.title),
    description: truncate(t.description, AI_LIMITS.tourDescription),
    language: t.language,
    city: t.city,
    type: t.type,
    duration_minutes: t.durationMinutes,
    places: (Array.isArray(t.places) ? t.places : []).slice(0, AI_LIMITS.places).map((pl) => compact({
      place_id: pl.placeId,
      name: truncate(pl.name, AI_LIMITS.placeName),
      type: pl.type,
      description: truncate(pl.description, AI_LIMITS.placeDescription),
    })),
  });
}

const malformed = (what) => new AiTemporaryError(`malformed AI response: ${what}`, { status: 200, kind: 'malformed' });
const isText = (v) => typeof v === 'string' && v.length > 0;

/** AI 200 body -> AiReviewer port result (camelCase, reasons tagged source 'ai'). */
export function fromAiResponse(body) {
  if (!body || typeof body !== 'object') throw malformed('not an object');
  if (!VERDICTS.has(body.verdict)) throw malformed('verdict');
  const { severity } = body;
  if (typeof severity !== 'number' || !Number.isFinite(severity) || severity < 0 || severity > 1) {
    throw malformed('severity');
  }
  const rawReasons = body.reasons ?? [];
  if (!Array.isArray(rawReasons)) throw malformed('reasons');
  const reasons = rawReasons.map((r) => {
    if (!r || !isText(r.field) || !isText(r.message)) throw malformed('reason');
    return {
      field: r.field,
      // An unknown category cannot be published (event enum); keep the finding under 'other'.
      category: AI_CATEGORIES.has(r.category) ? r.category : 'other',
      message: truncate(r.message, AI_LIMITS.reasonMessage),
      source: 'ai',
    };
  });
  return {
    verdict: body.verdict,
    severity,
    reasons,
    imagesChecked: Number.isInteger(body.images_checked) ? body.images_checked : 0,
    model: typeof body.model === 'string' ? body.model : null,
  };
}
