// =========================================================
// UC10 — Thêm điểm dừng vào tour (bước 5–11). Chỉ tác giả của tour.
// Kiểm vùng cấm (E2) trước khi lưu; thêm vào cuối danh sách (sequence kế tiếp).
// NSFW ảnh quét client-side — không ở đây.
// UC15 (MODERATION_EVENTS_ENABLED): with `moderation` the place starts 'checking', place.submitted
// is sent and a tour in moderation goes back to draft (see submit-for-moderation.js).
// Without it: unchanged.
// =========================================================
import { Place, PLACE_MODERATION } from '../../domain/entities/place.js';
import { Coordinates } from '../../domain/value-objects/coordinates.js';
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';
import { submitPlaceForModeration, withdrawTourFromModeration } from './submit-for-moderation.js';

export class AddPlace {
  /** @param {{ tourRepo, placeRepo, zoneChecker, moderation?, logger? }} deps */
  constructor({ tourRepo, placeRepo, zoneChecker, moderation = null, logger = console }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.zoneChecker = zoneChecker;
    this.moderation = moderation;
    this.logger = logger;
  }

  /** @param {{ authorId, tourId, name, type?, description, lat, lng, images?, audioUrl? }} input */
  async execute({ authorId, tourId, name, type, description, lat, lng, images, audioUrl }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const coords = new Coordinates(lat, lng);
    await this.zoneChecker.assertAllowed(coords); // E2

    const sequence = await this.placeRepo.nextSequence(tourId);
    const place = new Place({
      tourId,
      name: name.trim(),
      type,
      description: description.trim(), // E3
      lat: coords.lat,
      lng: coords.lng,
      sequence,
      images: images ?? [],
      audioUrl: audioUrl ?? null,
    });
    if (this.moderation) place.moderationStatus = PLACE_MODERATION.CHECKING;

    const created = await this.placeRepo.create(place);
    if (!this.moderation) return created.toPublic();
    await withdrawTourFromModeration(this, tour);
    return (await submitPlaceForModeration(this, created, tour)).toPublic();
  }
}
