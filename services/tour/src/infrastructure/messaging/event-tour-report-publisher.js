// =========================================================
// UC06 (#268) — community report signal for the admin side (UC20):
//   tour.reported { tourId, count, reason, flagged, contributorId, tourTitle, at }
// count = open reports of the tour after this one. The reporter id is NEVER part of the payload.
// Notification receives it but sends no email (internal signal, no template).
// `publish` is injected (shared/rabbitmq publish validates with the shared zod contract), so this
// file never imports ../shared and stays unit-testable in the repo layout.
// =========================================================

export const TOUR_REPORTED = 'tour.reported';

const optional = (v) => (v === null || v === undefined || v === '' ? undefined : v);

export class EventTourReportPublisher {
  /** @param {{ publish: (event: string, payload: object) => Promise<void>, clock?: () => Date }} deps */
  constructor({ publish, clock = () => new Date() }) {
    this.publish = publish;
    this.clock = clock;
  }

  /**
   * @param {import('../../domain/entities/tour.js').Tour} tour
   * @param {{ count: number, reason: string, flagged: boolean }} info
   */
  async reported(tour, { count, reason, flagged }) {
    const payload = {
      tourId: tour.id,
      count,
      reason,
      flagged: Boolean(flagged),
      contributorId: optional(tour.authorId),
      tourTitle: optional(tour.title),
      at: this.clock().toISOString(), // always ends with Z
    };
    await this.publish(TOUR_REPORTED, payload);
    return payload;
  }
}
