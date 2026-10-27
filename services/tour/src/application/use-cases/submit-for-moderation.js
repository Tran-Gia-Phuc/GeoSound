// =========================================================
// UC15 — shared steps to send a place / tour to AI moderation (MODERATION_EVENTS_ENABLED=true).
// Order matters: the revision is stored BEFORE publishing, so a fast result is never seen as stale.
// revision = the entity's updatedAt after the content save (ISO, ends with Z), echoed back by Moderation.
// A publish failure never fails the author's request: it is logged and the status stays
// 'checking' / 'ai_checking' (the author can edit the place or submit the tour again).
// A tour edit (or a place add/edit/delete/reorder) while the tour is in moderation withdraws it:
// back to 'draft' and moderationRevision cleared, so a late result can never approve edited content.
// =========================================================
import { PLACE_MODERATION } from '../../domain/entities/place.js';
import { TOUR_STATUS } from '../../domain/entities/tour.js';

export const revisionOf = (entity) => new Date(entity.updatedAt ?? Date.now()).toISOString();

/**
 * @param {{ placeRepo, moderation, logger? }} deps
 * @param {import('../../domain/entities/place.js').Place} place  saved place
 * @param {import('../../domain/entities/tour.js').Tour} tour
 * @returns {Promise<import('../../domain/entities/place.js').Place>} the place with moderation fields
 */
export async function submitPlaceForModeration({ placeRepo, moderation, logger = console }, place, tour) {
  const revision = revisionOf(place);
  const updated = await placeRepo.updateModeration(place.id, {
    moderationStatus: PLACE_MODERATION.CHECKING,
    moderationReasons: [],
    moderationRevision: revision,
  });
  try {
    await moderation.submitPlace(updated, tour, revision);
  } catch (err) {
    logger.error(`[tour] place.submitted not sent (placeId=${place.id}): ${err.message}`);
  }
  return updated;
}

/**
 * Flag on + tour in ai_checking / ai_warning / pending_review -> draft, revision cleared.
 * Flag off or tour not in moderation -> unchanged.
 * @param {{ tourRepo, moderation, logger? }} deps
 * @param {import('../../domain/entities/tour.js').Tour} tour
 * @returns {Promise<{ tour: import('../../domain/entities/tour.js').Tour, withdrawn: boolean }>}
 */
export async function withdrawTourFromModeration({ tourRepo, moderation, logger = console }, tour) {
  if (!moderation || !tour.isInModeration()) return { tour, withdrawn: false };
  logger.info?.(`[tour] tour ${tour.id} edited while ${tour.status}: back to draft`);
  const updated = await tourRepo.updateModeration(tour.id, {
    status: TOUR_STATUS.DRAFT,
    moderationRevision: null,
  });
  return { tour: updated, withdrawn: true };
}

/**
 * @param {{ tourRepo, moderation, logger? }} deps
 * @param {import('../../domain/entities/tour.js').Tour} tour  saved tour (status ai_checking)
 * @param {Array<import('../../domain/entities/place.js').Place>} places
 */
export async function submitTourForModeration({ tourRepo, moderation, logger = console }, tour, places) {
  const revision = revisionOf(tour);
  const updated = await tourRepo.updateModeration(tour.id, {
    moderationReasons: [],
    moderationRevision: revision,
  });
  try {
    await moderation.submitTour(updated, places, revision);
  } catch (err) {
    logger.error(`[tour] tour.submitted not sent (tourId=${tour.id}): ${err.message}`);
  }
  return updated;
}
