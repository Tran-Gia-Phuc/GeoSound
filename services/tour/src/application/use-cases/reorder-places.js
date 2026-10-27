// =========================================================
// UC10 / A2 — Sắp xếp lại thứ tự điểm dừng. Chỉ tác giả.
// `order` phải là đúng tập id các điểm của tour (không thiếu/thừa).
// UC15 (MODERATION_EVENTS_ENABLED): a tour in moderation goes back to draft (geo rules use the order).
// =========================================================
import {
  TourNotFoundError,
  NotTourOwnerError,
  ValidationError,
} from '../../domain/errors/index.js';
import { withdrawTourFromModeration } from './submit-for-moderation.js';

export class ReorderPlaces {
  /** @param {{ tourRepo, placeRepo, moderation?, logger? }} deps */
  constructor({ tourRepo, placeRepo, moderation = null, logger = console }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.moderation = moderation;
    this.logger = logger;
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
    await withdrawTourFromModeration(this, tour);
    const updated = await this.placeRepo.listByTour(tourId);
    return updated.map((p) => p.toPublic());
  }
}
