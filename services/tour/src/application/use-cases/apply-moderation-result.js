// =========================================================
// UC15 — apply an AI moderation result from Moderation (MODERATION_EVENTS_ENABLED=true).
//   place.ai_passed   -> place moderationStatus 'approved' ('warning' when warning:true)
//   place.ai_rejected -> place moderationStatus 'rejected'
//   tour.ai_passed    -> tour status 'pending_review' ('ai_warning' when warning:true)
//   tour.ai_rejected  -> tour status 'draft'
// Reasons (AI + geo) are stored for the owner. A result is applied only when its `revision`
// equals the revision Tour sent last (moderationRevision); otherwise it is stale and ignored.
// A tour result is applied only while the tour is 'ai_checking'.
// The write is conditional (repo.applyModerationResultIf = one UPDATE ... WHERE revision matches
// [and status = 'ai_checking']), so an edit racing with the result can never be overwritten.
// The reads before it only classify why a result is ignored (for the logs).
// =========================================================
import { PLACE_MODERATION } from '../../domain/entities/place.js';
import { TOUR_STATUS } from '../../domain/entities/tour.js';

export const MODERATION_RESULT_EVENTS = Object.freeze({
  PLACE_AI_PASSED: 'place.ai_passed',
  PLACE_AI_REJECTED: 'place.ai_rejected',
  TOUR_AI_PASSED: 'tour.ai_passed',
  TOUR_AI_REJECTED: 'tour.ai_rejected',
});
const E = MODERATION_RESULT_EVENTS;

// A rejection always carries `reason`; `reasons[]` is optional in the contract.
function reasonsOf(payload, rejected) {
  if (Array.isArray(payload.reasons) && payload.reasons.length) return payload.reasons;
  if (rejected && payload.reason) {
    return [{ field: 'general', category: 'other', message: payload.reason, source: 'ai' }];
  }
  return [];
}

export class ApplyModerationResult {
  /** @param {{ tourRepo, placeRepo, logger? }} deps */
  constructor({ tourRepo, placeRepo, logger = console }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.logger = logger;
  }

  /**
   * @param {string} eventName
   * @param {object} payload  already validated against the shared contract
   * @returns {Promise<{ applied: boolean, ignored?: string, status?: string }>}
   */
  async execute(eventName, payload) {
    switch (eventName) {
      case E.PLACE_AI_PASSED:
      case E.PLACE_AI_REJECTED:
        return this.applyPlace(eventName === E.PLACE_AI_REJECTED, payload);
      case E.TOUR_AI_PASSED:
      case E.TOUR_AI_REJECTED:
        return this.applyTour(eventName === E.TOUR_AI_REJECTED, payload);
      default:
        return this.ignore('unknown_event', `${eventName}`);
    }
  }

  async applyPlace(rejected, payload) {
    const place = await this.placeRepo.findById(payload.placeId);
    if (!place || place.tourId !== payload.tourId) {
      return this.ignore('not_found', `place ${payload.placeId}`);
    }
    if (place.moderationRevision !== payload.revision) {
      return this.ignore('stale', `place ${place.id} revision ${payload.revision}`);
    }
    let status = PLACE_MODERATION.APPROVED;
    if (rejected) status = PLACE_MODERATION.REJECTED;
    else if (payload.warning) status = PLACE_MODERATION.WARNING;

    const count = await this.placeRepo.applyModerationResultIf(place.id, payload.revision, {
      moderationStatus: status,
      moderationReasons: reasonsOf(payload, rejected),
    });
    if (!count) return this.ignore('stale', `place ${place.id} changed before the write`);
    return { applied: true, status };
  }

  async applyTour(rejected, payload) {
    const tour = await this.tourRepo.findById(payload.tourId);
    if (!tour) return this.ignore('not_found', `tour ${payload.tourId}`);
    if (tour.status !== TOUR_STATUS.AI_CHECKING) {
      return this.ignore('not_checking', `tour ${tour.id} is ${tour.status}`);
    }
    if (!payload.revision || tour.moderationRevision !== payload.revision) {
      return this.ignore('stale', `tour ${tour.id} revision ${payload.revision}`);
    }
    let status = TOUR_STATUS.PENDING_REVIEW;
    if (rejected) status = TOUR_STATUS.DRAFT;
    else if (payload.warning) status = TOUR_STATUS.AI_WARNING;

    const count = await this.tourRepo.applyModerationResultIf(tour.id, payload.revision, {
      status,
      moderationReasons: reasonsOf(payload, rejected),
    });
    if (!count) return this.ignore('stale', `tour ${tour.id} changed before the write`);
    return { applied: true, status };
  }

  ignore(why, detail) {
    this.logger.info?.(`[tour] moderation result ignored (${why}): ${detail}`);
    return { applied: false, ignored: why };
  }
}
