// UC07 — Danh sách lịch trình của chính khách (gắn ownerId).
import { summarizeItinerary } from './build-itinerary-view.js';

export class ListMyItineraries {
  /** @param {{ itineraryRepo }} deps */
  constructor({ itineraryRepo }) {
    this.itineraryRepo = itineraryRepo;
  }

  /** @param {{ ownerId: string }} input */
  async execute({ ownerId }) {
    const list = await this.itineraryRepo.listByOwner(ownerId);
    return list.map(summarizeItinerary);
  }
}
