// UC07 — Thêm một địa điểm vào lịch trình (bước 4/6; A2).
// BR: chỉ thêm địa điểm thuộc tour CÔNG KHAI. Snapshot dữ liệu điểm (đa ngữ)
// để lịch trình tự chứa, phục vụ phát lại (UC08) & chia sẻ/offline.
import { loadOwnedItinerary } from './load-owned-itinerary.js';
import { snapshotPlace } from './snapshot-place.js';
import { buildItineraryView } from './build-itinerary-view.js';
import { PlaceNotAddableError } from '../../domain/errors/index.js';

export class AddItineraryItem {
  /** @param {{ itineraryRepo, placeRepo, tourRepo, tourLanguageRepo?, placeTranslationRepo? }} deps */
  constructor({ itineraryRepo, placeRepo, tourRepo, tourLanguageRepo, placeTranslationRepo }) {
    this.itineraryRepo = itineraryRepo;
    this.placeRepo = placeRepo;
    this.tourRepo = tourRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
  }

  /** @param {{ ownerId: string, itineraryId: string, placeId: string, lang?: string }} input */
  async execute({ ownerId, itineraryId, placeId, lang }) {
    const itinerary = await loadOwnedItinerary(this.itineraryRepo, { ownerId, itineraryId });

    const place = await this.placeRepo.findById(placeId);
    if (!place) throw new PlaceNotAddableError();
    const tour = await this.tourRepo.findById(place.tourId);
    if (!tour || !tour.isPublic()) throw new PlaceNotAddableError();

    const [langs, translations] = await Promise.all([
      this.tourLanguageRepo?.listByTour(tour.id) ?? [],
      this.placeTranslationRepo?.listByTour(tour.id) ?? [],
    ]);

    const item = snapshotPlace({ place, sourceLanguage: tour.originalLanguage, langs, translations });
    itinerary.addItem(item);
    const saved = await this.itineraryRepo.save(itinerary);
    return buildItineraryView({ itinerary: saved, lang });
  }
}
