// =========================================================
// UC19 — admin decision events for the contributor (Notification, UC16):
//   tour.approved          { tourId, adminId, contributorId, tourTitle, at }
//   tour.rejected          { tourId, reason, contributorId, tourTitle, at }
//   tour.changes_requested { tourId, reason, contributorId, tourTitle, at }
// Payloads follow shared/events/index.js (camelCase, `at` ends with Z). `publish` is injected
// (shared/rabbitmq publish validates with the shared zod contract), so this file never imports
// ../shared and stays unit-testable in the repo layout.
// =========================================================

export const TOUR_REVIEW_EVENTS = Object.freeze({
  APPROVED: 'tour.approved',
  REJECTED: 'tour.rejected',
  CHANGES_REQUESTED: 'tour.changes_requested',
});

const MAX_REASON = 1000;
const optional = (v) => (v === null || v === undefined || v === '' ? undefined : v);

export class EventTourReviewPublisher {
  /** @param {{ publish: (event: string, payload: object) => Promise<void>, clock?: () => Date }} deps */
  constructor({ publish, clock = () => new Date() }) {
    this.publish = publish;
    this.clock = clock;
  }

  recipient(tour) {
    return {
      tourId: tour.id,
      contributorId: optional(tour.authorId),
      tourTitle: optional(tour.title),
      at: this.clock().toISOString(), // always ends with Z
    };
  }

  async send(event, payload) {
    await this.publish(event, payload);
    return payload;
  }

  /** @param {import('../../domain/entities/tour.js').Tour} tour @param {string} adminId */
  approved(tour, adminId) {
    return this.send(TOUR_REVIEW_EVENTS.APPROVED, { ...this.recipient(tour), adminId });
  }

  /** @param {import('../../domain/entities/tour.js').Tour} tour @param {string} reason */
  rejected(tour, reason) {
    return this.send(TOUR_REVIEW_EVENTS.REJECTED, {
      ...this.recipient(tour),
      reason: String(reason).slice(0, MAX_REASON),
    });
  }

  /** @param {import('../../domain/entities/tour.js').Tour} tour @param {string} reason */
  changesRequested(tour, reason) {
    return this.send(TOUR_REVIEW_EVENTS.CHANGES_REQUESTED, {
      ...this.recipient(tour),
      reason: String(reason).slice(0, MAX_REASON),
    });
  }
}
