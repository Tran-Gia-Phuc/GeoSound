// =========================================================
// UC09 / A3 — Xuất bản & gỡ tour (xuất bản thẳng, bỏ qua kiểm duyệt — D1).
//   - PublishTour        : kiểm tra sẵn sàng → status = public (khách tìm thấy)
//   - UnpublishTour      : public → draft (khách không còn thấy)
//   - GetPublishReadiness: checklist sẵn sàng cho màn "Xuất bản" của Studio
// Chỉ tác giả. Sửa tour đang công khai vẫn đưa về Nháp như cũ (Tour.applyEdits).
// UC15 (MODERATION_EVENTS_ENABLED): with `moderation`, PublishTour becomes "submit for review":
// extra checks (D5: no place 'checking'/'rejected'; at most 50 places), status = ai_checking and
// tour.submitted is sent. The AI result comes back via ApplyModerationResult.
// Without it: direct publish as today.
// =========================================================
import { checkPublishReadiness } from '../../domain/tour/publish-readiness.js';
import {
  TourNotFoundError,
  NotTourOwnerError,
  TourNotReadyError,
  TourStatusTransitionError,
} from '../../domain/errors/index.js';
import { submitTourForModeration } from './submit-for-moderation.js';

async function loadOwned(tourRepo, { authorId, tourId }) {
  const tour = await tourRepo.findById(tourId);
  if (!tour) throw new TourNotFoundError();
  if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();
  return tour;
}

export class GetPublishReadiness {
  /** @param {{ tourRepo, placeRepo, moderation? }} deps */
  constructor({ tourRepo, placeRepo, moderation = null }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.moderation = moderation;
  }

  /** @param {{ authorId: string, tourId: string }} input */
  async execute(input) {
    const tour = await loadOwned(this.tourRepo, input);
    const places = await this.placeRepo.listByTour(tour.id);
    return {
      status: tour.status,
      canPublish: tour.canPublish(),
      placeCount: places.length,
      ...checkPublishReadiness({ tour, places, requireModeration: Boolean(this.moderation) }),
    };
  }
}

export class PublishTour {
  /** @param {{ tourRepo, placeRepo, moderation?, logger? }} deps */
  constructor({ tourRepo, placeRepo, moderation = null, logger = console }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.moderation = moderation;
    this.logger = logger;
  }

  /** @param {{ authorId: string, tourId: string }} input */
  async execute(input) {
    const tour = await loadOwned(this.tourRepo, input);
    if (tour.isPublic()) return { tour: tour.toPublic(), changed: false };
    if (!tour.canPublish()) {
      throw new TourStatusTransitionError('Tour đang bị quản trị viên ẩn/hạn chế, không thể tự xuất bản');
    }

    const places = await this.placeRepo.listByTour(tour.id);
    const { ready, checks } = checkPublishReadiness({
      tour,
      places,
      requireModeration: Boolean(this.moderation),
    });
    if (!ready) {
      throw new TourNotReadyError(
        checks.filter((c) => c.required && !c.ok).map(({ key, label }) => ({ key, label })),
      );
    }

    if (this.moderation) {
      tour.submitForModeration();
      const saved = await this.tourRepo.save(tour);
      const submitted = await submitTourForModeration(this, saved, places);
      return { tour: submitted.toPublic(), changed: true };
    }

    tour.publish();
    const saved = await this.tourRepo.save(tour);
    return { tour: saved.toPublic(), changed: true };
  }
}

export class UnpublishTour {
  /** @param {{ tourRepo }} deps */
  constructor({ tourRepo }) {
    this.tourRepo = tourRepo;
  }

  /** @param {{ authorId: string, tourId: string }} input */
  async execute(input) {
    const tour = await loadOwned(this.tourRepo, input);
    if (!tour.isPublic()) {
      throw new TourStatusTransitionError('Chỉ gỡ được tour đang công khai');
    }
    tour.unpublish();
    const saved = await this.tourRepo.save(tour);
    return { tour: saved.toPublic() };
  }
}
