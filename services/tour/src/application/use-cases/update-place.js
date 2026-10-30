// =========================================================
// UC10 / A3 — Sửa điểm dừng. Chỉ tác giả của tour; điểm phải thuộc tour đó.
// Đổi tọa độ → kiểm lại vùng cấm (E2).
// UC15 (MODERATION_EVENTS_ENABLED): a name/description/images change resubmits the place
// (place.submitted); a change of what the tour scan reads withdraws a tour in moderation.
// =========================================================
import { Coordinates } from '../../domain/value-objects/coordinates.js';
import {
  TourNotFoundError,
  NotTourOwnerError,
  PlaceNotFoundError,
} from '../../domain/errors/index.js';
import { MODERATED_FIELDS, TOUR_SCAN_FIELDS } from '../../domain/entities/place.js';
import { submitPlaceForModeration, withdrawTourFromModeration } from './submit-for-moderation.js';

export class UpdatePlace {
  /** @param {{ tourRepo, placeRepo, zoneChecker, moderation?, logger? }} deps */
  constructor({ tourRepo, placeRepo, zoneChecker, moderation = null, logger = console }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.zoneChecker = zoneChecker;
    this.moderation = moderation;
    this.logger = logger;
  }

  /** @param {{ authorId, tourId, placeId, patch }} input */
  async execute({ authorId, tourId, placeId, patch }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const place = await this.placeRepo.findById(placeId);
    if (!place || place.tourId !== tourId) throw new PlaceNotFoundError();

    const fields = { ...patch };
    if (fields.lat !== undefined || fields.lng !== undefined) {
      const coords = new Coordinates(fields.lat ?? place.lat, fields.lng ?? place.lng);
      await this.zoneChecker.assertAllowed(coords); // E2
      fields.lat = coords.lat;
      fields.lng = coords.lng;
    }
    if (fields.name !== undefined) fields.name = fields.name.trim();
    if (fields.description !== undefined) fields.description = fields.description.trim();

    // Compare before applying: only a real change of the moderated content triggers a new check.
    const changed = (keys) =>
      keys.some((k) => fields[k] !== undefined && JSON.stringify(fields[k]) !== JSON.stringify(place[k]));
    const contentChanged = changed(MODERATED_FIELDS);
    const tourScanChanged = changed(TOUR_SCAN_FIELDS);
    place.applyEdits(fields);
    const saved = await this.placeRepo.save(place);
    if (!this.moderation) return saved.toPublic();
    if (tourScanChanged) await withdrawTourFromModeration(this, tour);
    if (!contentChanged) return saved.toPublic();
    return (await submitPlaceForModeration(this, saved, tour)).toPublic();
  }
}
