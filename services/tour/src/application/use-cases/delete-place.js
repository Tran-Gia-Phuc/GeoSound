// =========================================================
// UC10 / A3 — Xóa điểm dừng khỏi tour. Chỉ tác giả; điểm phải thuộc tour đó.
// =========================================================
import {
  TourNotFoundError,
  NotTourOwnerError,
  PlaceNotFoundError,
} from '../../domain/errors/index.js';

export class DeletePlace {
  /** @param {{ tourRepo, placeRepo }} deps */
  constructor({ tourRepo, placeRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
  }

  /** @param {{ authorId, tourId, placeId }} input */
  async execute({ authorId, tourId, placeId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const place = await this.placeRepo.findById(placeId);
    if (!place || place.tourId !== tourId) throw new PlaceNotFoundError();

    await this.placeRepo.delete(placeId);
    return { id: placeId };
  }
}
