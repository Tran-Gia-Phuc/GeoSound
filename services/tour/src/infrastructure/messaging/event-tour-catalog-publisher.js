// =========================================================
// #240 — chatbot index events over RabbitMQ (only when CHATBOT_EVENTS_ENABLED=true).
// Builds tour.published / tour.unpublished exactly as shared/events/index.js expects (camelCase).
// `publish` is injected (shared/rabbitmq publish, which validates the payload with the shared
// zod contract), so this file never imports ../shared and stays unit-testable in the repo layout.
//
// revision = the later of tour.updatedAt and now. A place or translation edit on a public tour
// does not touch tour.updatedAt, and the AI indexer ignores a revision it has already seen, so the
// event time keeps every re-send (and the final unpublish) newer than the last indexed revision.
// =========================================================

// Event limits (shared/events): Tour allows longer texts, so the payload is cut to the contract.
const MAX_TITLE = 200;
const MAX_TOUR_DESCRIPTION = 5000;
const MAX_PLACE_NAME = 200;
const MAX_PLACE_DESCRIPTION = 2000;
const MAX_TRANSLATION = 5000;
const MAX_PLACES = 50;
const TOUR_TYPES = new Set(['walking', 'driving', 'cycling', 'indoor']);
const LANGUAGE = /^.{2,10}$/;

const toDate = (d) => (d instanceof Date ? d : new Date(d));
const cut = (s, n) => String(s ?? '').slice(0, n);
const optional = (v) => (v === null || v === undefined || v === '' ? undefined : v);

export const TOUR_PUBLISHED = 'tour.published';
export const TOUR_UNPUBLISHED = 'tour.unpublished';

export class EventTourCatalogPublisher {
  /** @param {{ publish: (event: string, payload: object) => Promise<void>, clock?: () => Date, logger? }} deps */
  constructor({ publish, clock = () => new Date(), logger = console }) {
    this.publish = publish;
    this.clock = clock;
    this.logger = logger;
  }

  revision(tour, now) {
    const updated = tour.updatedAt ? toDate(tour.updatedAt) : null;
    return (updated && updated > now ? updated : now).toISOString(); // always ends with Z
  }

  /**
   * @param {import('../../domain/entities/tour.js').Tour} tour  saved tour (status public)
   * @param {Array<import('../../domain/entities/place.js').Place>} places
   * @param {{ languages?: string[], translations?: Array<{ placeId: string, languageCode: string, text: string }> }} [i18n]
   * @returns {Promise<object|null>} the payload, or null when the tour cannot be described by the contract
   */
  async publishTourPublished(tour, places, { languages = [], translations = [] } = {}) {
    if (!TOUR_TYPES.has(tour.type)) {
      this.logger.warn?.(`[tour] tour.published skipped (tourId=${tour.id}): unknown type '${tour.type}'`);
      return null;
    }
    const byPlace = new Map();
    for (const t of translations) {
      if (!LANGUAGE.test(t.languageCode ?? '') || t.languageCode === tour.originalLanguage) continue;
      const list = byPlace.get(t.placeId) ?? [];
      list.push({ language: t.languageCode, text: cut(t.text, MAX_TRANSLATION) });
      byPlace.set(t.placeId, list);
    }
    const codes = [...new Set(languages)].filter((c) => LANGUAGE.test(c ?? ''));
    const now = this.clock();
    const payload = {
      tourId: tour.id,
      revision: this.revision(tour, now),
      status: 'public',
      title: cut(tour.title, MAX_TITLE),
      description: cut(tour.description, MAX_TOUR_DESCRIPTION),
      language: tour.originalLanguage,
      city: optional(tour.city),
      type: tour.type,
      durationMinutes: Number.isInteger(tour.duration) && tour.duration >= 0 ? tour.duration : undefined,
      languages: codes.length ? codes : undefined,
      places: [...places]
        .sort((a, b) => a.sequence - b.sequence)
        .slice(0, MAX_PLACES)
        .map((p) => ({
          placeId: p.id,
          name: cut(p.name, MAX_PLACE_NAME),
          type: optional(p.type),
          description: cut(p.description, MAX_PLACE_DESCRIPTION),
          lat: p.lat,
          lng: p.lng,
          sequence: p.sequence,
          translations: byPlace.get(p.id),
        })),
      at: now.toISOString(),
    };
    await this.publish(TOUR_PUBLISHED, payload);
    return payload;
  }

  /**
   * @param {import('../../domain/entities/tour.js').Tour} tour  the tour that left `public`
   * @param {'unpublished'|'edited'|'hidden'|'restricted'|'deleted'} reason
   */
  async publishTourUnpublished(tour, reason) {
    const now = this.clock();
    const payload = { tourId: tour.id, revision: this.revision(tour, now), reason, at: now.toISOString() };
    await this.publish(TOUR_UNPUBLISHED, payload);
    return payload;
  }
}
