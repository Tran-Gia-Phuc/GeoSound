// =========================================================
// UC09 / A1.1 — mở một tour của mình (đổ dữ liệu vào form chỉnh sửa).
// Chặn xem tour của người khác (quy tắc: chỉ tác giả).
// =========================================================
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';

export class GetMyTour {
  /** @param {{ tourRepo: import('../../domain/ports/index.js').TourRepository }} deps */
  constructor({ tourRepo }) {
    this.tourRepo = tourRepo;
  }

  /** @param {{ authorId: string, tourId: string }} input */
  async execute({ authorId, tourId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError(); // E3
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();
    return tour.toPublic();
  }
}
