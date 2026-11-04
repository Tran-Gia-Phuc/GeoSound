// =========================================================
// UC17 (#271) — tour statistics (docs/02-design/uc17-tour-stats.md). Pure: the actions and their
// counter columns, the UTC day bucket, the hashed actor key, the stats period and the totals.
// =========================================================
import crypto from 'node:crypto';
import { ValidationError } from '../errors/index.js';

/** AI_PLAN L11 — action -> daily counter column. */
export const ACTIVITY_COUNTERS = Object.freeze({
  view: 'views', // tour detail opened
  play: 'plays', // first stop started
  complete: 'completions', // last stop ended
  download: 'downloads', // offline package saved
});
export const ACTIVITY_ACTIONS = Object.freeze(Object.keys(ACTIVITY_COUNTERS));

export const DAILY_MARK_CAP = 200; // recorded marks per actor per UTC day, across all tours
export const MARK_RETENTION_DAYS = 40;
export const STATS_DEFAULT_DAYS = 30;
export const STATS_MAX_DAYS = 366;
export const STATS_COMMENTS_TAKE = 20;
export const DEFAULT_ACTOR_SALT = 'geosound-uc17-stats';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC calendar day of a time, as 'YYYY-MM-DD'. */
export function utcDay(at = new Date()) {
  return new Date(at).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' shifted by n days (UTC). */
export function addDays(day, n) {
  return utcDay(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
}

/** A real calendar day ('2026-02-30' is not). */
export function isDay(text) {
  return typeof text === 'string' && DAY_RE.test(text) && utcDay(Date.parse(`${text}T00:00:00Z`) || 0) === text;
}

/**
 * Who did the action: the account when a valid token is present, else the client device id. Hashed
 * with a per-deployment salt so the table never holds a raw account or device id. The kind prefix keeps
 * an account id and a device id with the same text apart.
 * @param {{ userId?: string|null, deviceId?: string|null, salt?: string }} input
 * @returns {string|null} 64 hex characters, or null when there is no actor
 */
export function actorKey({ userId, deviceId, salt = DEFAULT_ACTOR_SALT }) {
  const id = userId ? `u:${userId}` : deviceId ? `d:${deviceId}` : null;
  if (!id) return null;
  return crypto.createHash('sha256').update(`${salt || DEFAULT_ACTOR_SALT}|${id}`).digest('hex');
}

/**
 * Stats period: default the last 30 days ending today (UTC), both ends included, at most 366 days.
 * @param {{ from?: string, to?: string, now?: Date }} input
 * @returns {{ from: string, to: string }}
 */
export function resolvePeriod({ from, to, now = new Date() } = {}) {
  if (from !== undefined && !isDay(from)) throw new ValidationError('Ngày bắt đầu không hợp lệ', { from: 'Ngày bắt đầu không hợp lệ' });
  if (to !== undefined && !isDay(to)) throw new ValidationError('Ngày kết thúc không hợp lệ', { to: 'Ngày kết thúc không hợp lệ' });
  const end = to ?? (from ? minDay(addDays(from, STATS_DEFAULT_DAYS - 1), utcDay(now)) : utcDay(now));
  const start = from ?? addDays(end, -(STATS_DEFAULT_DAYS - 1));
  if (start > end) throw new ValidationError('Ngày bắt đầu phải trước ngày kết thúc', { from: 'Ngày bắt đầu phải trước ngày kết thúc' });
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS + 1;
  if (days > STATS_MAX_DAYS) {
    throw new ValidationError(`Khoảng thời gian tối đa ${STATS_MAX_DAYS} ngày`, { from: `Khoảng thời gian tối đa ${STATS_MAX_DAYS} ngày` });
  }
  return { from: start, to: end };
}

const minDay = (a, b) => (a < b ? a : b);

/** Totals of daily rows, with completionRate = completions / plays (0 without plays, at most 1). */
export function totalsOf(daily) {
  const t = { views: 0, plays: 0, completions: 0, downloads: 0 };
  for (const d of daily) for (const k of Object.keys(t)) t[k] += Number(d[k] ?? 0);
  const rate = t.plays > 0 ? Math.min(t.completions / t.plays, 1) : 0;
  return { ...t, completionRate: Math.round(rate * 10000) / 10000 };
}
