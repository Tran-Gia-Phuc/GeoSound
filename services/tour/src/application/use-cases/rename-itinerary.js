// UC07 — Đổi tên lịch trình. E2 (thiếu tên) do entity kiểm.
import { loadOwnedItinerary } from './load-owned-itinerary.js';
import { summarizeItinerary } from './build-itinerary-view.js';

export class RenameItinerary {
  /** @param {{ itineraryRepo }} deps */
  constructor({ itineraryRepo }) {
    this.itineraryRepo = itineraryRepo;
  }

  /** @param {{ ownerId: string, itineraryId: string, name: string }} input */
  async execute({ ownerId, itineraryId, name }) {
    const itinerary = await loadOwnedItinerary(this.itineraryRepo, { ownerId, itineraryId });
    itinerary.rename(name);
    const saved = await this.itineraryRepo.save(itinerary);
    return summarizeItinerary(saved);
  }
}
