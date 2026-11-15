// =========================================================
// UC09 — Tạo tour mới (bước 4–8). Tạo ở trạng thái "Nháp" (draft).
// NSFW ảnh bìa được quét client-side (NSFW.js) trước khi gửi lên — không ở đây.
// =========================================================
import { Tour, TOUR_STATUS } from '../../domain/entities/tour.js';
import { Language } from '../../domain/value-objects/language.js';

export class CreateTour {
  /** @param {{ tourRepo: import('../../domain/ports/index.js').TourRepository }} deps */
  constructor({ tourRepo }) {
    this.tourRepo = tourRepo;
  }

  /** @param {{ authorId: string, title: string, description?: string, coverImageUrl?: string, originalLanguage: string, type?: string, city?: string, duration?: number }} input */
  async execute({ authorId, title, description, coverImageUrl, originalLanguage, type, city, duration }) {
    const language = new Language(originalLanguage); // E2 — ngôn ngữ gốc bắt buộc/hợp lệ

    const tour = new Tour({
      title: title.trim(),
      description: (description ?? '').trim(),
      coverImageUrl: coverImageUrl ?? null,
      originalLanguage: language.value,
      type,
      status: TOUR_STATUS.DRAFT,
      authorId,
      city: city?.trim() ?? null,
      duration: duration ?? null,
    });

    const created = await this.tourRepo.create(tour);
    return created.toPublic();
  }
}
