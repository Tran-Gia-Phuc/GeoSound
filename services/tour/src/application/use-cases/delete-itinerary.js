// UC07 — Xoá lịch trình (kèm toàn bộ điểm — cascade ở DB).
import { loadOwnedItinerary } from './load-owned-itinerary.js';

export class DeleteItinerary {
  /** @param {{ itineraryRepo }} deps */
  constructor({ itineraryRepo }) {
    this.itineraryRepo = itineraryRepo;
  }

  /** @param {{ ownerId: string, itineraryId: string }} input */
  async execute({ ownerId, itineraryId }) {
    const itinerary = await loadOwnedItinerary(this.itineraryRepo, { ownerId, itineraryId });
    await this.itineraryRepo.delete(itinerary.id);
    return { id: itinerary.id, deleted: true };
  }
}
