// =========================================================
// UC20 (#273) — rules of the admin handling of reported tours (docs/02-design/uc20-report-handling.md).
// Pure: which status each action starts from, the queue order and the paging limits.
// =========================================================
import { TOUR_STATUS } from '../entities/tour.js';

// R3 — hide only a public tour; R4 — restore only a hidden one (decision L13: straight back to public).
export const HIDEABLE_FROM = Object.freeze([TOUR_STATUS.PUBLIC]);
export const RESTORABLE_FROM = Object.freeze([TOUR_STATUS.HIDDEN]);

export const canHide = (status) => HIDEABLE_FROM.includes(status);
export const canRestore = (status) => RESTORABLE_FROM.includes(status);

export const QUEUE_PAGE_DEFAULT = 20;
export const QUEUE_PAGE_MAX = 50;

const time = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);

/**
 * R1 — queue order: most open reports first, then flagged tours (UC06 R5), then the oldest open report
 * first, then the id (stable). Items: { tourId, openReportCount, flaggedAt, oldestReportAt }.
 * The SQL of the repository applies the same order; this function is the reference and serves fakes.
 */
export function compareReportQueue(a, b) {
  return (
    b.openReportCount - a.openReportCount ||
    (a.flaggedAt ? 0 : 1) - (b.flaggedAt ? 0 : 1) ||
    time(a.oldestReportAt) - time(b.oldestReportAt) ||
    String(a.tourId).localeCompare(String(b.tourId))
  );
}

/** Actions an admin can take now (dossier hint for the client; the writes check again). */
export function availableReportActions(status, openReportCount) {
  return { hide: canHide(status), restore: canRestore(status), dismiss: openReportCount > 0 };
}
