// =========================================================
// UC10 / A3 — Sửa điểm dừng. Chỉ tác giả của tour; điểm phải thuộc tour đó.
// Đổi tọa độ → kiểm lại vùng cấm (E2).
// =========================================================
import { Coordinates } from '../../domain/value-objects/coordinates.js';
import {
  TourNotFoundError,
  NotTourOwnerError,
  PlaceNotFoundError,
} from '../../domain/errors/index.js';

export class UpdatePlace {
  /** @param {{ tourRepo, placeRepo, zoneChecker }} deps */
  constructor({ tourRepo, placeRepo, zoneChecker }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.zoneChecker = zoneChecker;
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

    place.applyEdits(fields);
    const saved = await this.placeRepo.save(place);
    return saved.toPublic();
  }
}
