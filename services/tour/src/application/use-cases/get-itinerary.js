// UC07 — Xem một lịch trình của chính mình: view đầy đủ (điểm + bản đồ + khoảng
// cách/thời gian) dùng cho trình chỉnh sửa và bản đồ.
import { loadOwnedItinerary } from './load-owned-itinerary.js';
import { buildItineraryView } from './build-itinerary-view.js';

export class GetItinerary {
  /** @param {{ itineraryRepo }} deps */
  constructor({ itineraryRepo }) {
    this.itineraryRepo = itineraryRepo;
  }

  /** @param {{ ownerId: string, itineraryId: string, lang?: string }} input */
  async execute({ ownerId, itineraryId, lang }) {
    const itinerary = await loadOwnedItinerary(this.itineraryRepo, { ownerId, itineraryId });
    return buildItineraryView({ itinerary, lang });
  }
}
