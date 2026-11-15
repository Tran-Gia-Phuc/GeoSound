// UC07 / A4 — Xem lịch trình được chia sẻ công khai theo mã (không cần đăng nhập,
// chỉ đọc). Dùng cho bạn bè mở link và cũng là nguồn cho UC08 khi đi tour chia sẻ.
import { ItineraryNotFoundError } from '../../domain/errors/index.js';
import { buildItineraryView } from './build-itinerary-view.js';

export class GetSharedItinerary {
  /** @param {{ itineraryRepo }} deps */
  constructor({ itineraryRepo }) {
    this.itineraryRepo = itineraryRepo;
  }

  /** @param {{ token: string, lang?: string }} input */
  async execute({ token, lang }) {
    const itinerary = await this.itineraryRepo.findByShareToken(token);
    if (!itinerary) throw new ItineraryNotFoundError();
    const view = buildItineraryView({ itinerary, lang });
    return { ...view, shared: true };
  }
}
