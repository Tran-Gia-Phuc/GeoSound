// UC07 — Xoá một điểm khỏi lịch trình (A2). Dồn lại thứ tự (entity lo).
import { loadOwnedItinerary } from './load-owned-itinerary.js';
import { buildItineraryView } from './build-itinerary-view.js';
import { PlaceNotFoundError } from '../../domain/errors/index.js';

export class RemoveItineraryItem {
  /** @param {{ itineraryRepo }} deps */
  constructor({ itineraryRepo }) {
    this.itineraryRepo = itineraryRepo;
  }

  /** @param {{ ownerId: string, itineraryId: string, itemId: string, lang?: string }} input */
  async execute({ ownerId, itineraryId, itemId, lang }) {
    const itinerary = await loadOwnedItinerary(this.itineraryRepo, { ownerId, itineraryId });
    if (!itinerary.removeItem(itemId)) throw new PlaceNotFoundError('Không tìm thấy điểm trong lịch trình');
    const saved = await this.itineraryRepo.save(itinerary);
    return buildItineraryView({ itinerary: saved, lang });
  }
}
