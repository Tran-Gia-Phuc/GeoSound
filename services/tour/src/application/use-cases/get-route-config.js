// =========================================================
// UC11 (bước 1–2) — Lấy cấu hình route & kích hoạt của tour để mở tab chỉnh sửa.
// Chỉ tác giả. Trả cấu hình HIỆU LỰC (effectiveRoute): phần chưa lưu được điền
// mặc định (route nối các điểm, vùng tròn 50 m) — đúng thứ khách sẽ trải nghiệm.
// `isDefault` = chưa từng lưu cấu hình.
// =========================================================
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';
import { effectiveRoute } from '../../domain/route/effective-route.js';

export class GetRouteConfig {
  /** @param {{ tourRepo, placeRepo?, routeConfigRepo }} deps */
  constructor({ tourRepo, placeRepo, routeConfigRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.routeConfigRepo = routeConfigRepo;
  }

  /** @param {{ authorId, tourId }} input */
  async execute({ authorId, tourId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const [saved, places] = await Promise.all([
      this.routeConfigRepo.findByTour(tourId),
      this.placeRepo?.listByTour(tourId) ?? [],
    ]);
    return {
      tourId,
      ...effectiveRoute({ places, config: saved }),
      updatedAt: saved?.updatedAt ?? null,
    };
  }
}
