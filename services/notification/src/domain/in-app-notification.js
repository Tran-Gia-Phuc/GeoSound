// =========================================================
// UC16 (#270) — pure mapping "tour event -> in-app notification row" (no I/O, no shared import).
// Recipient = payload.contributorId (the tour author); no contributorId -> null (stored for nobody).
// Only whitelisted keys reach `data`: reporter identity or any other payload key is never stored.
// =========================================================
import { createHash } from 'node:crypto';

export const IN_APP_EVENTS = Object.freeze([
  'tour.ai_rejected',
  'tour.approved',
  'tour.rejected',
  'tour.changes_requested',
  'tour.hidden',
  'tour.reported',
  'tts.render.completed',
]);

export const MAX_TITLE_IN_TITLE = 120;
export const MAX_BODY = 1000;
const MAX_REASONS = 20;

// Vietnamese title per event. `t` = «tour title» or null when the event has no title.
const TITLES = {
  'tour.ai_rejected': (t) => (t ? `Tour ${t} không qua kiểm duyệt tự động` : 'Tour của bạn không qua kiểm duyệt tự động'),
  'tour.approved': (t) => (t ? `Tour ${t} đã được duyệt` : 'Tour của bạn đã được duyệt'),
  'tour.rejected': (t) => (t ? `Tour ${t} bị từ chối` : 'Tour của bạn bị từ chối'),
  'tour.changes_requested': (t) => (t ? `Tour ${t} cần chỉnh sửa` : 'Tour của bạn cần chỉnh sửa'),
  'tour.hidden': (t) => (t ? `Tour ${t} đã bị ẩn` : 'Tour của bạn đã bị ẩn'),
  'tour.reported': (t) => (t ? `Tour ${t} bị khách báo cáo` : 'Tour của bạn bị khách báo cáo'),
  'tts.render.completed': (t) => (t ? `Thuyết minh của tour ${t} đã sẵn sàng` : 'Thuyết minh cho tour của bạn đã sẵn sàng'),
};

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function clip(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** JSON with sorted keys, so the same payload always gives the same string. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Idempotency key: event name + tourId + SHA-256 of the whole payload. A redelivered message has the
 * same payload (same `at`), so it maps to the same key; a new event has a new `at` (or new count).
 */
export function sourceKeyOf(event, payload = {}) {
  const digest = createHash('sha256').update(`${event}\n${stableStringify(payload)}`).digest('hex');
  return `${event}:${payload.tourId ?? '-'}:${digest}`;
}

// AI reasons of tour.ai_rejected: keep the fields the contributor needs, nothing else.
function aiReasons(reasons) {
  if (!Array.isArray(reasons)) return undefined;
  const out = reasons
    .filter((r) => r && typeof r === 'object' && text(r.message))
    .slice(0, MAX_REASONS)
    .map((r) => ({
      field: text(r.field) ?? undefined,
      category: text(r.category) ?? undefined,
      message: clip(text(r.message), 500),
    }));
  return out.length ? out : undefined;
}

function dataOf(event, payload) {
  const data = {};
  if (event === 'tour.ai_rejected') {
    const reasons = aiReasons(payload.reasons);
    if (reasons) data.reasons = reasons;
  }
  if (event === 'tour.reported') {
    if (Number.isInteger(payload.count) && payload.count >= 0) data.count = payload.count;
    if (typeof payload.flagged === 'boolean') data.flagged = payload.flagged;
  }
  if (event === 'tts.render.completed' && Array.isArray(payload.assets)) {
    data.languages = payload.assets.map((a) => text(a?.lang)).filter(Boolean);
  }
  return data;
}

/**
 * @returns {null | { userId, type, tourId, title, body, data, sourceKey }}
 *   null when the event is not an in-app event or has no recipient (no contributorId).
 */
export function buildInAppNotification(event, payload = {}) {
  const titleOf = TITLES[event];
  if (!titleOf || !payload || typeof payload !== 'object') return null;
  const userId = text(payload.contributorId);
  if (!userId) return null;

  const tourTitle = text(payload.tourTitle);
  const reason = text(payload.reason);
  return {
    userId,
    type: event,
    tourId: text(payload.tourId),
    title: titleOf(tourTitle ? `«${clip(tourTitle, MAX_TITLE_IN_TITLE)}»` : null),
    body: reason ? clip(reason, MAX_BODY) : null,
    data: dataOf(event, payload),
    sourceKey: sourceKeyOf(event, payload),
  };
}
