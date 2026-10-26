// =========================================================
// UC09 / A3 — Xuất bản & gỡ tour (xuất bản thẳng, bỏ qua kiểm duyệt — D1).
//   - PublishTour        : kiểm tra sẵn sàng → status = public (khách tìm thấy)
//   - UnpublishTour      : public → draft (khách không còn thấy)
//   - GetPublishReadiness: checklist sẵn sàng cho màn "Xuất bản" của Studio
// Chỉ tác giả. Sửa tour đang công khai vẫn đưa về Nháp như cũ (Tour.applyEdits).
// Khi làm lại kiểm duyệt (UC15) chỉ cần đổi PublishTour sang "gửi duyệt".
// =========================================================
import { checkPublishReadiness } from '../../domain/tour/publish-readiness.js';
import {
  TourNotFoundError,
  NotTourOwnerError,
  TourNotReadyError,
  TourStatusTransitionError,
} from '../../domain/errors/index.js';

async function loadOwned(tourRepo, { authorId, tourId }) {
  const tour = await tourRepo.findById(tourId);
  if (!tour) throw new TourNotFoundError();
  if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();
  return tour;
}

export class GetPublishReadiness {
  /** @param {{ tourRepo, placeRepo }} deps */
  constructor({ tourRepo, placeRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
  }

  /** @param {{ authorId: string, tourId: string }} input */
  async execute(input) {
    const tour = await loadOwned(this.tourRepo, input);
    const places = await this.placeRepo.listByTour(tour.id);
    return { status: tour.status, canPublish: tour.canPublish(), ...checkPublishReadiness({ tour, places }) };
  }
}

export class PublishTour {
  /** @param {{ tourRepo, placeRepo }} deps */
  constructor({ tourRepo, placeRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
  }

  /** @param {{ authorId: string, tourId: string }} input */
  async execute(input) {
    const tour = await loadOwned(this.tourRepo, input);
    if (tour.isPublic()) return { tour: tour.toPublic(), changed: false };
    if (!tour.canPublish()) {
      throw new TourStatusTransitionError('Tour đang bị quản trị viên ẩn/hạn chế, không thể tự xuất bản');
    }

    const places = await this.placeRepo.listByTour(tour.id);
    const { ready, checks } = checkPublishReadiness({ tour, places });
    if (!ready) {
      throw new TourNotReadyError(
        checks.filter((c) => c.required && !c.ok).map(({ key, label }) => ({ key, label })),
      );
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
