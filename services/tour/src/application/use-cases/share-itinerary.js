// UC07 / A4 — Chia sẻ lịch trình: sinh mã chia sẻ (dùng lại nếu đã có) hoặc thu
// hồi. Client ghép link /shared/:token từ shareToken trả về.
import { loadOwnedItinerary } from './load-owned-itinerary.js';

export class ShareItinerary {
  /** @param {{ itineraryRepo, generateToken: () => string }} deps */
  constructor({ itineraryRepo, generateToken }) {
    this.itineraryRepo = itineraryRepo;
    this.generateToken = generateToken;
  }

  /** @param {{ ownerId: string, itineraryId: string, enabled?: boolean }} input */
  async execute({ ownerId, itineraryId, enabled = true }) {
    const itinerary = await loadOwnedItinerary(this.itineraryRepo, { ownerId, itineraryId });
    if (enabled) itinerary.ensureShareToken(this.generateToken);
    else itinerary.revokeShare();
    const saved = await this.itineraryRepo.save(itinerary);
    return { id: saved.id, shareToken: saved.shareToken, shared: !!saved.shareToken };
  }
}
