// =========================================================
// #240 — tell the chatbot index (AI service) when a tour enters, changes inside, or leaves `public`
// (CHATBOT_EVENTS_ENABLED=true; `catalog` is null when the flag is off -> nothing happens).
// Called AFTER the database write succeeded. A publish failure never fails the author's request:
// it is logged only (the indexer catches up on the next publish of the tour).
// Only places that passed AI moderation are sent: a place still 'checking' (or 'rejected') never
// reaches the chatbot. When its result arrives, ApplyModerationResult re-sends the tour.
// =========================================================
import { PLACE_MODERATION } from '../../domain/entities/place.js';

const NOT_INDEXED = new Set([PLACE_MODERATION.CHECKING, PLACE_MODERATION.REJECTED]);

/**
 * Sends tour.published with the current places (and translations when the repos are given).
 * @param {{ catalog, placeRepo, tourLanguageRepo?, placeTranslationRepo?, logger? }} deps
 * @param {import('../../domain/entities/tour.js').Tour} tour  saved tour, status public
 */
export async function notifyTourPublished(
  { catalog, placeRepo, tourLanguageRepo = null, placeTranslationRepo = null, logger = console },
  tour,
) {
  if (!catalog || !tour.isPublic()) return;
  try {
    const places = (await placeRepo.listByTour(tour.id)).filter((p) => !NOT_INDEXED.has(p.moderationStatus));
    const languages = tourLanguageRepo
      ? (await tourLanguageRepo.listByTour(tour.id)).map((l) => l.languageCode)
      : [];
    const translations = placeTranslationRepo ? await placeTranslationRepo.listByTour(tour.id) : [];
    await catalog.publishTourPublished(tour, places, { languages, translations });
  } catch (err) {
    logger.error(`[tour] tour.published not sent (tourId=${tour.id}): ${err.message}`);
  }
}

/**
 * Sends tour.unpublished (the indexer deletes everything about the tour).
 * @param {{ catalog, logger? }} deps
 * @param {import('../../domain/entities/tour.js').Tour} tour
 * @param {'unpublished'|'edited'|'deleted'} reason
 */
export async function notifyTourUnpublished({ catalog, logger = console }, tour, reason) {
  if (!catalog) return;
  try {
    await catalog.publishTourUnpublished(tour, reason);
  } catch (err) {
    logger.error(`[tour] tour.unpublished not sent (tourId=${tour.id}): ${err.message}`);
  }
}
