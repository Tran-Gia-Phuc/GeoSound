// UC07 — Tạo lịch trình cá nhân (đặt tên). E2 (thiếu tên) do entity kiểm.
import { Itinerary } from '../../domain/entities/itinerary.js';
import { summarizeItinerary } from './build-itinerary-view.js';

export class CreateItinerary {
  /** @param {{ itineraryRepo }} deps */
  constructor({ itineraryRepo }) {
    this.itineraryRepo = itineraryRepo;
  }

  /** @param {{ ownerId: string, name: string }} input */
  async execute({ ownerId, name }) {
    const itinerary = new Itinerary({ ownerId, name });
    const saved = await this.itineraryRepo.create(itinerary);
    return summarizeItinerary(saved);
  }
}
