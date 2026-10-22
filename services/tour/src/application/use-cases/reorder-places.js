// =========================================================
// UC10 / A2 — Sắp xếp lại thứ tự điểm dừng. Chỉ tác giả.
// `order` phải là đúng tập id các điểm của tour (không thiếu/thừa).
// =========================================================
import {
  TourNotFoundError,
  NotTourOwnerError,
  ValidationError,
} from '../../domain/errors/index.js';

export class ReorderPlaces {
  /** @param {{ tourRepo, placeRepo }} deps */
  constructor({ tourRepo, placeRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
  }

  /** @param {{ authorId, tourId, orderedIds: string[] }} input */
  async execute({ authorId, tourId, orderedIds }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const places = await this.placeRepo.listByTour(tourId);
    const currentIds = new Set(places.map((p) => p.id));
    const uniqueNew = new Set(orderedIds);
    const sameSet =
      orderedIds.length === places.length &&
      uniqueNew.size === orderedIds.length &&
      orderedIds.every((id) => currentIds.has(id));
    if (!sameSet) {
      throw new ValidationError('Danh sách thứ tự không khớp các điểm của tour');
    }

    await this.placeRepo.reorder(tourId, orderedIds);
    const updated = await this.placeRepo.listByTour(tourId);
    return updated.map((p) => p.toPublic());
  }
}
