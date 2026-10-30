// =========================================================
// UC09 / A1 — Sửa tour. Chỉ tác giả. Chuẩn hóa dữ liệu rồi để entity áp
// quy tắc: sửa tour đang công khai → đưa về "Nháp" (phải gửi duyệt lại — UC15).
// UC15 (MODERATION_EVENTS_ENABLED): editing what the tour scan reads while the tour is in
// moderation (ai_checking / ai_warning / pending_review) also sends it back to draft.
// #240 (CHATBOT_EVENTS_ENABLED): a public tour sent back to draft -> tour.unpublished ('edited').
// =========================================================
import { Language } from '../../domain/value-objects/language.js';
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';
import { withdrawTourFromModeration } from './submit-for-moderation.js';
import { notifyTourUnpublished } from './notify-tour-catalog.js';

// Fields carried by tour.submitted.
const TOUR_SCAN_FIELDS = ['title', 'description', 'originalLanguage', 'type', 'city', 'duration'];

export class UpdateTour {
  /** @param {{ tourRepo: import('../../domain/ports/index.js').TourRepository, moderation?, catalog?, logger? }} deps */
  constructor({ tourRepo, moderation = null, catalog = null, logger = console }) {
    this.tourRepo = tourRepo;
    this.moderation = moderation;
    this.catalog = catalog;
    this.logger = logger;
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
    if (fields.city !== undefined) fields.city = fields.city.trim();

    const scanChanged = TOUR_SCAN_FIELDS.some((k) => fields[k] !== undefined && fields[k] !== tour[k]);
    const wasPublic = tour.isPublic();
    const requiresResubmit = tour.applyEdits(fields);
    const saved = await this.tourRepo.save(tour);
    if (wasPublic && !saved.isPublic()) await notifyTourUnpublished(this, saved, 'edited');
    if (!this.moderation || !scanChanged) return { tour: saved.toPublic(), requiresResubmit };
    const { tour: result, withdrawn } = await withdrawTourFromModeration(this, saved);
    return { tour: result.toPublic(), requiresResubmit: requiresResubmit || withdrawn };
  }
}
