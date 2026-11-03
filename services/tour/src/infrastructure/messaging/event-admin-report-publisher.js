// =========================================================
// UC20 (#273) — admin report decisions for the contributor (Notification, UC16):
//   tour.hidden   { tourId, reason, contributorId, tourTitle, at }    (existing event, email template exists)
//   tour.restored { tourId, reason?, contributorId, tourTitle, at }   (new, additive)
// Payloads follow shared/events/index.js (camelCase, `at` ends with Z). `publish` is injected
// (shared/rabbitmq publish validates with the shared zod contract), so this file never imports
// ../shared and stays unit-testable in the repo layout. The reporter ids are never sent.
// =========================================================

export const ADMIN_REPORT_EVENTS = Object.freeze({
  HIDDEN: 'tour.hidden',
  RESTORED: 'tour.restored',
});

const MAX_REASON = 1000;
const optional = (v) => (v === null || v === undefined || v === '' ? undefined : v);

export class EventAdminReportPublisher {
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

  /** @param {import('../../domain/entities/tour.js').Tour} tour @param {string} reason */
  hidden(tour, reason) {
    return this.send(ADMIN_REPORT_EVENTS.HIDDEN, {
      ...this.recipient(tour),
      reason: String(reason).slice(0, MAX_REASON),
    });
  }

  /** @param {import('../../domain/entities/tour.js').Tour} tour @param {string|null} [reason] */
  restored(tour, reason = null) {
    const text = optional(reason);
    return this.send(ADMIN_REPORT_EVENTS.RESTORED, {
      ...this.recipient(tour),
      ...(text ? { reason: String(text).slice(0, MAX_REASON) } : {}),
    });
  }
}
