// =========================================================
// UC15 — ModerationGateway over RabbitMQ events (only when MODERATION_EVENTS_ENABLED=true).
// Builds place.submitted / tour.submitted exactly as shared/events/index.js expects (camelCase).
// `publish` is injected (shared/rabbitmq publish, which validates the payload with the shared
// zod contract), so this file never imports ../shared and stays unit-testable in the repo layout.
// =========================================================

// Event limits (shared/events): Tour allows longer descriptions (5000) and more images (20),
// so the payload is cut to what the contract accepts. Moderation only judges what it receives.
// The 50-place limit is NOT cut here: PublishTour blocks a bigger tour (readiness 'placesLimit').
const MAX_DESCRIPTION = 2000;
const MAX_IMAGES = 5;

const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString(); // always ends with Z
const cut = (s, n) => String(s ?? '').slice(0, n);
const optional = (v) => (v === null || v === undefined || v === '' ? undefined : v);

export const PLACE_SUBMITTED = 'place.submitted';
export const TOUR_SUBMITTED = 'tour.submitted';

export class EventModerationGateway {
  /** @param {{ publish: (event: string, payload: object) => Promise<void>, clock?: () => Date }} deps */
  constructor({ publish, clock = () => new Date() }) {
    this.publish = publish;
    this.clock = clock;
  }

  /**
   * @param {import('../../domain/entities/place.js').Place} place  saved place (has id, updatedAt)
   * @param {import('../../domain/entities/tour.js').Tour} tour
   * @param {string} revision  ISO string echoed back in place.ai_passed / place.ai_rejected
   */
  async submitPlace(place, tour, revision) {
    const payload = {
      placeId: place.id,
      tourId: tour.id,
      contributorId: tour.authorId,
      revision,
      name: place.name,
      type: optional(place.type),
      description: cut(place.description, MAX_DESCRIPTION),
      language: tour.originalLanguage,
      lat: place.lat,
      lng: place.lng,
      city: optional(tour.city),
      images: (place.images ?? []).slice(0, MAX_IMAGES).map((img) => ({
        url: img.url,
        ...(img.caption ? { caption: img.caption } : {}),
      })),
      at: iso(this.clock()),
    };
    await this.publish(PLACE_SUBMITTED, payload);
    return payload;
  }

  /**
   * @param {import('../../domain/entities/tour.js').Tour} tour  saved tour (status ai_checking)
   * @param {Array<import('../../domain/entities/place.js').Place>} places  ordered by sequence
   * @param {string} revision
   */
  async submitTour(tour, places, revision) {
    const payload = {
      tourId: tour.id,
      contributorId: tour.authorId,
      revision,
      title: tour.title,
      description: tour.description ?? '',
      language: tour.originalLanguage,
      city: optional(tour.city),
      type: optional(tour.type),
      durationMinutes: Number.isInteger(tour.duration) ? tour.duration : undefined,
      places: places.map((p) => ({
        placeId: p.id,
        name: p.name,
        type: optional(p.type),
        description: cut(p.description, MAX_DESCRIPTION),
        lat: p.lat,
        lng: p.lng,
        sequence: p.sequence,
      })),
      at: iso(this.clock()),
    };
    await this.publish(TOUR_SUBMITTED, payload);
    return payload;
  }
}
