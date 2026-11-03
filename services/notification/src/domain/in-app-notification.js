// =========================================================
// UC16 (#270) — pure mapping "tour event -> in-app notification row" (no I/O, no shared import).
// Recipient = payload.contributorId (the tour author); no contributorId -> null (stored for nobody).
// Only whitelisted keys reach `data`: reporter identity or any other payload key is never stored.
// UC21: account.moderated -> one notification for the account owner (payload.userId), title per action.
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

// UC21 — admin action on the user's account (recipient = payload.userId, not a tour event).
export const ACCOUNT_MODERATED = 'account.moderated';

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

// '14:05 30/10/2026' in Vietnam time (UTC+7, no DST); null for a missing or bad date.
function vietnamTime(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// UC21 — title per admin action on the account.
const ACCOUNT_TITLES = {
  warn: () => 'Tài khoản của bạn nhận một cảnh báo',
  suspend: (until) => (until ? `Tài khoản của bạn bị tạm khoá đến ${until}` : 'Tài khoản của bạn bị tạm khoá'),
  ban: () => 'Tài khoản của bạn đã bị cấm',
  restore: () => 'Tài khoản của bạn đã được khôi phục',
};

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
  // Tour events always carry tourId (unchanged keys); account.moderated is keyed by userId.
  return `${event}:${payload.tourId ?? payload.userId ?? '-'}:${digest}`;
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
  if (event === ACCOUNT_MODERATED) return buildAccountNotification(payload);
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

/** UC21 — account.moderated -> in-app row for payload.userId; null without a user or a known action. */
function buildAccountNotification(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const userId = text(payload.userId);
  const titleOf = Object.hasOwn(ACCOUNT_TITLES, payload.action ?? '') ? ACCOUNT_TITLES[payload.action] : null;
  if (!userId || !titleOf) return null;
  const until = payload.action === 'suspend' ? vietnamTime(payload.until) : null;
  const reason = text(payload.reason);
  const data = { action: payload.action };
  if (until) data.until = payload.until;
  return {
    userId,
    type: ACCOUNT_MODERATED,
    tourId: null,
    title: titleOf(until),
    body: reason ? clip(reason, MAX_BODY) : null,
    data,
    sourceKey: sourceKeyOf(ACCOUNT_MODERATED, payload),
  };
}
