// =========================================================
// UC09 / A1 — Sửa tour. Chỉ tác giả. Chuẩn hóa dữ liệu rồi để entity áp
// quy tắc: sửa tour đang công khai → đưa về "Nháp" (phải gửi duyệt lại — UC15).
// =========================================================
import { Language } from '../../domain/value-objects/language.js';
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';

export class UpdateTour {
  /** @param {{ tourRepo: import('../../domain/ports/index.js').TourRepository }} deps */
  constructor({ tourRepo }) {
    this.tourRepo = tourRepo;
  }

  /** @param {{ authorId: string, tourId: string, patch: Record<string, any> }} input */
  async execute({ authorId, tourId, patch }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError(); // E3
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const fields = { ...patch };
    if (fields.originalLanguage !== undefined) {
      fields.originalLanguage = new Language(fields.originalLanguage).value; // E2
    }
    if (fields.title !== undefined) fields.title = fields.title.trim();
    if (fields.description !== undefined) fields.description = fields.description.trim();

    const requiresResubmit = tour.applyEdits(fields);
    const saved = await this.tourRepo.save(tour);
    return { tour: saved.toPublic(), requiresResubmit };
  }
}
