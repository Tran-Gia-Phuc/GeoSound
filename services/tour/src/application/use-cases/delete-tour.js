// =========================================================
// UC09 / A2 — Xóa tour (kể cả tour đã công khai). Chỉ tác giả.
// Xóa xong tour tự biến mất khỏi kết quả tìm kiếm (UC02) vì không còn bản ghi.
// #240 (CHATBOT_EVENTS_ENABLED): deleting a public tour sends tour.unpublished ('deleted').
// =========================================================
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';
import { notifyTourUnpublished } from './notify-tour-catalog.js';

export class DeleteTour {
  /** @param {{ tourRepo: import('../../domain/ports/index.js').TourRepository, catalog?, logger? }} deps */
  constructor({ tourRepo, catalog = null, logger = console }) {
    this.tourRepo = tourRepo;
    this.catalog = catalog;
    this.logger = logger;
  }

  /** @param {{ authorId: string, tourId: string }} input */
  async execute({ authorId, tourId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError(); // E3
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    await this.tourRepo.delete(tourId);
    if (tour.isPublic()) await notifyTourUnpublished(this, tour, 'deleted');
    return { id: tourId };
  }
}
