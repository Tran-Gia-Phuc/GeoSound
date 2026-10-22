// =========================================================
// UC10 — Danh sách điểm dừng của một tour (theo thứ tự). Chỉ tác giả.
// =========================================================
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';

export class ListPlaces {
  /** @param {{ tourRepo, placeRepo }} deps */
  constructor({ tourRepo, placeRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
  }

  /** @param {{ authorId, tourId }} input */
  async execute({ authorId, tourId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const places = await this.placeRepo.listByTour(tourId);
    return places.map((p) => p.toPublic());
  }
}
