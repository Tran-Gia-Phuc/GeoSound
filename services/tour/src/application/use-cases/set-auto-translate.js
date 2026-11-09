// =========================================================
// UC12 — the author allows or forbids automatic translation for tourists (tours.auto_translate).
// Off: tourists can no longer ask for a language the author did not turn on, and the automatic
// translations made before are hidden (buildTourDetailView). Only the column is written; the tour
// status and updated_at (moderation / catalog revision) do not move. Chỉ tác giả.
// =========================================================
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';

export class SetAutoTranslate {
  /** @param {{ tourRepo }} deps */
  constructor({ tourRepo }) {
    this.tourRepo = tourRepo;
  }

  /** @param {{ authorId: string, tourId: string, enabled: boolean }} input */
  async execute({ authorId, tourId, enabled }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();
    if (tour.autoTranslate === enabled) return { autoTranslate: enabled };
    const saved = await this.tourRepo.setAutoTranslate(tour, enabled);
    return { autoTranslate: saved.autoTranslate };
  }
}
