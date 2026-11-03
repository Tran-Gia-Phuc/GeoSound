// =========================================================
// UC22 (#275) — rules of the admin dashboard, the action log and the UC21 violation history
// (docs/02-design/uc22-dashboard-log.md). Pure: periods, limits, the top contributor rule and the
// average review time. The repository runs the same rules in SQL; these functions are the reference
// and serve the in-memory fakes of the tests.
// =========================================================
import { ValidationError } from '../errors/index.js';

export const DASHBOARD_DEFAULT_DAYS = 7;
export const DASHBOARD_MAX_DAYS = 366;
export const LOG_PAGE_DEFAULT = 20;
export const LOG_PAGE_MAX = 100;
export const TOP_CONTRIBUTOR_LIMIT = 5;
export const TOP_CONTRIBUTOR_MIN_RATING = 4;
export const VIOLATION_ACTIONS_LIMIT = 20;
export const VIOLATION_TOURS_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function badPeriod(message) {
  return new ValidationError(message, { period: message });
}

/**
 * One bound of a period. `YYYY-MM-DD` is a whole UTC day: as `from` it starts at 00:00, as `to` it
 * includes the day (exclusive end = next midnight). A full ISO date-time is used as it is.
 * @param {string|undefined|null} value @param {{ end?: boolean }} [opts] @returns {Date|null}
 */
export function parseBound(value, { end = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  const date = DATE_ONLY.test(text) ? new Date(`${text}T00:00:00.000Z`) : new Date(text);
  if (Number.isNaN(date.getTime())) throw badPeriod('Thời gian không hợp lệ');
  return DATE_ONLY.test(text) && end ? new Date(date.getTime() + DAY_MS) : date;
}

/**
 * Dashboard period [from, to): default the last 7 days up to `now`; at most 366 days; from < to.
 * Only `from` -> up to now; only `to` -> the 7 days before it.
 * @param {{ from?: string, to?: string }} input @param {Date} now
 * @returns {{ from: Date, to: Date }}
 */
export function resolveDashboardPeriod({ from, to } = {}, now = new Date()) {
  const end = parseBound(to, { end: true }) ?? now;
  const start = parseBound(from) ?? new Date(end.getTime() - DASHBOARD_DEFAULT_DAYS * DAY_MS);
  if (start >= end) throw badPeriod('Thời gian bắt đầu phải trước thời gian kết thúc');
  if (end - start > DASHBOARD_MAX_DAYS * DAY_MS) {
    throw badPeriod(`Khoảng thời gian tối đa ${DASHBOARD_MAX_DAYS} ngày`);
  }
  return { from: start, to: end };
}

/** Optional log filter period: either bound may be missing (open interval); from < to when both. */
export function resolveLogPeriod({ from, to } = {}) {
  const start = parseBound(from);
  const end = parseBound(to, { end: true });
  if (start && end && start >= end) throw badPeriod('Thời gian bắt đầu phải trước thời gian kết thúc');
  return { from: start, to: end };
}

export const inPeriod = (date, { from, to }) => {
  const t = new Date(date).getTime();
  return (!from || t >= from.getTime()) && (!to || t < to.getTime());
};

/** Hours with 2 decimals; null (no decision with a queued time) -> 0 on the dashboard (E1). */
export const secondsToHours = (seconds) =>
  seconds === null || seconds === undefined ? 0 : Math.round((Number(seconds) / 3600) * 100) / 100;

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Average review time of UC19 decisions: mean of (decision time - data.queuedAt) in seconds, over the
 * entries that carry a queuedAt not after the decision. Null when there is none.
 * @param {Array<{ createdAt: Date, data?: { queuedAt?: string } }>} decisions  already filtered (period, action)
 */
export function averageReviewSeconds(decisions) {
  const spans = [];
  for (const d of decisions) {
    const queued = d.data?.queuedAt ? new Date(d.data.queuedAt).getTime() : NaN;
    const span = (new Date(d.createdAt).getTime() - queued) / 1000;
    if (Number.isFinite(span) && span >= 0) spans.push(span);
  }
  return spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : null;
}

/**
 * Top contributors (decision L14): authors with the most public tours rated >= 4 on average, leaving
 * out every author with a `hide_tour` action on any of their tours within the period.
 * @param {Array<{ authorId: string, status: string, averageRating: number, ratingCount: number }>} tours
 * @param {Set<string>} hiddenAuthors  authors with a hide in the period
 * @returns {Array<{ authorId: string, publicTours: number, averageRating: number }>}
 */
export function rankTopContributors(tours, hiddenAuthors, limit = TOP_CONTRIBUTOR_LIMIT) {
  const byAuthor = new Map();
  for (const t of tours) {
    if (t.status !== 'public' || !(t.ratingCount > 0) || t.averageRating < TOP_CONTRIBUTOR_MIN_RATING) continue;
    if (hiddenAuthors.has(t.authorId)) continue;
    const a = byAuthor.get(t.authorId) ?? { authorId: t.authorId, publicTours: 0, sum: 0 };
    a.publicTours += 1;
    a.sum += t.averageRating;
    byAuthor.set(t.authorId, a);
  }
  return [...byAuthor.values()]
    .map((a) => ({ authorId: a.authorId, publicTours: a.publicTours, averageRating: a.sum / a.publicTours }))
    .sort(compareContributors)
    .slice(0, limit)
    .map((a) => ({ ...a, averageRating: round2(a.averageRating) }));
}

/** Most qualifying tours first, then the higher average, then the author id (stable). */
export function compareContributors(a, b) {
  return (
    b.publicTours - a.publicTours ||
    b.averageRating - a.averageRating ||
    String(a.authorId).localeCompare(String(b.authorId))
  );
}

/**
 * Idempotency key of a log row fed by account.moderated: one action of one account at one time.
 * @param {{ userId: string, action: string, at: string }} payload
 */
export const accountActionSourceKey = ({ userId, action, at }) => `account.moderated:${userId}:${action}:${at}`;
