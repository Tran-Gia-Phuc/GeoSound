// UC07 — Sắp xếp lại thứ tự các điểm (A2). orderedIds phải khớp tập điểm hiện có.
import { loadOwnedItinerary } from './load-owned-itinerary.js';
import { buildItineraryView } from './build-itinerary-view.js';

export class ReorderItineraryItems {
  /** @param {{ itineraryRepo }} deps */
  constructor({ itineraryRepo }) {
    this.itineraryRepo = itineraryRepo;
  }

  /** @param {{ ownerId: string, itineraryId: string, orderedIds: string[], lang?: string }} input */
  async execute({ ownerId, itineraryId, orderedIds, lang }) {
    const itinerary = await loadOwnedItinerary(this.itineraryRepo, { ownerId, itineraryId });
    itinerary.reorder(orderedIds); // ném ValidationError nếu không khớp
    const saved = await this.itineraryRepo.save(itinerary);
    return buildItineraryView({ itinerary: saved, lang });
  }
}
