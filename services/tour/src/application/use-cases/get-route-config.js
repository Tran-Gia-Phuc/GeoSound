// =========================================================
// UC11 (bước 1–2) — Lấy cấu hình route & kích hoạt của tour để mở tab chỉnh sửa.
// Chỉ tác giả. Chưa từng lưu → trả cấu hình rỗng (route/triggers/navAudios = []).
// =========================================================
import { RouteConfig } from '../../domain/entities/route-config.js';
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';

export class GetRouteConfig {
  /** @param {{ tourRepo, routeConfigRepo }} deps */
  constructor({ tourRepo, routeConfigRepo }) {
    this.tourRepo = tourRepo;
    this.routeConfigRepo = routeConfigRepo;
  }

  /** @param {{ authorId, tourId }} input */
  async execute({ authorId, tourId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const config = (await this.routeConfigRepo.findByTour(tourId)) ?? RouteConfig.empty(tourId);
    return config.toPublic();
  }
}
