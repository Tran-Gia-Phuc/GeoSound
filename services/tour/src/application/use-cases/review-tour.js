// =========================================================
// UC19 — admin review (tier 2 of moderation). Admin role only (checked by the router).
//   ListReviewQueue    : tours in ai_warning / pending_review; ai_warning first, then oldest first (E1: [])
//   GetReviewDossier   : read-only view: tour, ordered places (images, audio, moderation), tour
//                        AI/geo reasons, route config, review history
//   ApproveTour        : -> public            + tour.approved (+ tour.published for the chatbot)
//   RejectTour         : -> rejected (reason) + tour.rejected
//   RequestTourChanges : -> changes_requested (reason) + tour.changes_requested (author resubmits, UC15)
// Decisions are conditional writes (repo.applyReviewDecisionIf = UPDATE ... WHERE status IN
// reviewable, log row in the same transaction): 409 when the tour is not reviewable or another
// write won the race. Events are sent after the write; a publish failure is logged and never fails
// the request. Admins never change the tour content.
// =========================================================
import { TOUR_STATUS, REVIEWABLE_STATUSES } from '../../domain/entities/tour.js';
import { REVIEW_ACTION, REVIEW_TARGET_STATUS } from '../../domain/entities/tour-review-action.js';
import { TourNotFoundError, TourNotReviewableError } from '../../domain/errors/index.js';
import { notifyTourPublished } from './notify-tour-catalog.js';

const toTime = (d) => (d ? new Date(d).getTime() : 0);

/** UC19 step 2 — ai_warning first, then the oldest submission (updatedAt) first. Pure, stable. */
export function sortReviewQueue(tours) {
  const rank = (t) => (t.status === TOUR_STATUS.AI_WARNING ? 0 : 1);
  return [...tours].sort((a, b) => rank(a) - rank(b) || toTime(a.updatedAt) - toTime(b.updatedAt));
}

function queueItem(tour) {
  return {
    id: tour.id,
    title: tour.title,
    coverImageUrl: tour.coverImageUrl,
    originalLanguage: tour.originalLanguage,
    type: tour.type,
    city: tour.city,
    status: tour.status,
    aiWarning: tour.status === TOUR_STATUS.AI_WARNING,
    authorId: tour.authorId,
    moderationReasons: tour.moderationReasons,
    submittedAt: tour.updatedAt,
  };
}

export class ListReviewQueue {
  /** @param {{ tourRepo }} deps */
  constructor({ tourRepo }) {
    this.tourRepo = tourRepo;
  }

  async execute() {
    const tours = await this.tourRepo.listByStatuses(REVIEWABLE_STATUSES);
    return sortReviewQueue(tours).map(queueItem);
  }
}

export class GetReviewDossier {
  /** @param {{ tourRepo, placeRepo, reviewActionRepo, routeConfigRepo? }} deps */
  constructor({ tourRepo, placeRepo, reviewActionRepo, routeConfigRepo = null }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.reviewActionRepo = reviewActionRepo;
    this.routeConfigRepo = routeConfigRepo;
  }

  /** @param {{ tourId: string }} input */
  async execute({ tourId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    const [places, routeConfig, history] = await Promise.all([
      this.placeRepo.listByTour(tour.id),
      this.routeConfigRepo ? this.routeConfigRepo.findByTour(tour.id) : null,
      this.reviewActionRepo.listByTour(tour.id),
    ]);
    return {
      tour: { ...tour.toPublic(), aiWarning: tour.status === TOUR_STATUS.AI_WARNING },
      reviewable: tour.isReviewable(),
      places: [...places].sort((a, b) => a.sequence - b.sequence).map((p) => p.toPublic()),
      routeConfig: routeConfig ? routeConfig.toPublic() : null,
      history: history.map((h) => h.toPublic()),
    };
  }
}

/** Shared flow of the three decisions. */
class ReviewDecision {
  /**
   * @param {{ tourRepo, placeRepo?, reviewEvents?, catalog?, tourLanguageRepo?, placeTranslationRepo?, logger? }} deps
   */
  constructor({
    tourRepo,
    placeRepo = null,
    reviewEvents = null,
    catalog = null,
    tourLanguageRepo = null,
    placeTranslationRepo = null,
    logger = console,
  }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.reviewEvents = reviewEvents;
    this.catalog = catalog;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
    this.logger = logger;
  }

  /**
   * @param {{ tourId: string, adminId: string, reason?: string|null }} input
   * @param {string} action  REVIEW_ACTION value
   */
  async decide({ tourId, adminId, reason = null }, action) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isReviewable()) throw new TourNotReviewableError();

    const status = REVIEW_TARGET_STATUS[action];
    const count = await this.tourRepo.applyReviewDecisionIf(
      tour.id,
      REVIEWABLE_STATUSES,
      { status, reviewReason: action === REVIEW_ACTION.APPROVE ? null : reason },
      { adminId, action, reason: action === REVIEW_ACTION.APPROVE ? null : reason, fromStatus: tour.status },
    );
    // Another decision (or an author edit) changed the status between the read and the write.
    if (!count) throw new TourNotReviewableError('Tour vừa được cập nhật bởi thao tác khác, vui lòng tải lại');

    return (await this.tourRepo.findById(tour.id)) ?? tour;
  }

  /** Sends one review event; a failure is logged only (the decision is already saved). */
  async emit(name, tour, send) {
    if (!this.reviewEvents) return;
    try {
      await send(this.reviewEvents);
    } catch (err) {
      this.logger.error(`[tour] ${name} not sent (tourId=${tour.id}): ${err.message}`);
    }
  }
}

export class ApproveTour extends ReviewDecision {
  /** @param {{ tourId: string, adminId: string }} input */
  async execute(input) {
    const saved = await this.decide({ ...input, reason: null }, REVIEW_ACTION.APPROVE);
    await this.emit('tour.approved', saved, (ev) => ev.approved(saved, input.adminId));
    // #240 — chatbot index (no-op unless CHATBOT_EVENTS_ENABLED; failures are logged inside).
    if (this.placeRepo) await notifyTourPublished(this, saved);
    return { tour: saved.toPublic(), action: REVIEW_ACTION.APPROVE };
  }
}

export class RejectTour extends ReviewDecision {
  /** @param {{ tourId: string, adminId: string, reason: string }} input */
  async execute(input) {
    const saved = await this.decide(input, REVIEW_ACTION.REJECT);
    await this.emit('tour.rejected', saved, (ev) => ev.rejected(saved, input.reason));
    return { tour: saved.toPublic(), action: REVIEW_ACTION.REJECT };
  }
}

export class RequestTourChanges extends ReviewDecision {
  /** @param {{ tourId: string, adminId: string, reason: string }} input */
  async execute(input) {
    const saved = await this.decide(input, REVIEW_ACTION.REQUEST_CHANGES);
    await this.emit('tour.changes_requested', saved, (ev) => ev.changesRequested(saved, input.reason));
    return { tour: saved.toPublic(), action: REVIEW_ACTION.REQUEST_CHANGES };
  }
}
