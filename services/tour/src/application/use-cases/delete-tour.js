// =========================================================
// UC09 / A2 — Xóa tour (kể cả tour đã công khai). Chỉ tác giả.
// Xóa xong tour tự biến mất khỏi kết quả tìm kiếm (UC02) vì không còn bản ghi.
// =========================================================
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';

export class DeleteTour {
  /** @param {{ tourRepo: import('../../domain/ports/index.js').TourRepository }} deps */
  constructor({ tourRepo }) {
    this.tourRepo = tourRepo;
  }

  /** @param {{ authorId: string, tourId: string }} input */
  async execute({ authorId, tourId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError(); // E3
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    await this.tourRepo.delete(tourId);
    return { id: tourId };
  }
}
