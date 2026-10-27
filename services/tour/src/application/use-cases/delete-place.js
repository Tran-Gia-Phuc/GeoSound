// =========================================================
// UC10 / A3 — Xóa điểm dừng khỏi tour. Chỉ tác giả; điểm phải thuộc tour đó.
// UC15 (MODERATION_EVENTS_ENABLED): a tour in moderation goes back to draft.
// =========================================================
import {
  TourNotFoundError,
  NotTourOwnerError,
  PlaceNotFoundError,
} from '../../domain/errors/index.js';
import { withdrawTourFromModeration } from './submit-for-moderation.js';

export class DeletePlace {
  /** @param {{ tourRepo, placeRepo, moderation?, logger? }} deps */
  constructor({ tourRepo, placeRepo, moderation = null, logger = console }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.moderation = moderation;
    this.logger = logger;
  }

  /** @param {{ authorId, tourId, placeId }} input */
  async execute({ authorId, tourId, placeId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const place = await this.placeRepo.findById(placeId);
    if (!place || place.tourId !== tourId) throw new PlaceNotFoundError();

    await this.placeRepo.delete(placeId);
    await withdrawTourFromModeration(this, tour);
    return { id: placeId };
  }
}
