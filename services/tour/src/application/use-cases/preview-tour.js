// =========================================================
// UC13 — Xem thử tour (preview). Tác giả xem tour CỦA MÌNH như một khách thật
// (GPS giả lập, nghe audio, xem route) để kiểm tra trước khi gửi duyệt/công khai.
// Khác UC02 (GetPublicTour): KHÔNG lọc trạng thái công khai — preview chạy với
// MỌI trạng thái (nháp/chờ duyệt/bị từ chối/ẩn...), nhưng:
//   - bắt buộc đăng nhập + chỉ tác giả (isOwnedBy) — preview không công khai
//   - E1: tour chưa có điểm nào → không thể preview. Route/vùng kích hoạt chưa
//     cấu hình thì được tự sinh (effectiveRoute), không còn chặn xem thử.
// Payload dựng từ buildTourDetailView (giống UC02) để client tái dùng đúng
// trình phát/bản đồ của trải nghiệm nghe (UC04). A1/A2 xử lý phía client.
// =========================================================
import {
  TourNotFoundError,
  NotTourOwnerError,
  TourNotPreviewableError,
} from '../../domain/errors/index.js';
import { buildTourDetailView } from './build-tour-detail.js';

export class PreviewTour {
  /** @param {{ tourRepo, placeRepo, routeConfigRepo, tourLanguageRepo?, placeTranslationRepo? }} deps */
  constructor({ tourRepo, placeRepo, routeConfigRepo, tourLanguageRepo, placeTranslationRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.routeConfigRepo = routeConfigRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
  }

  /** @param {{ authorId: string, tourId: string, lang?: string }} input */
  async execute({ authorId, tourId, lang }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const [places, routeCfg, langs, translations] = await Promise.all([
      this.placeRepo.listByTour(tourId),
      this.routeConfigRepo.findByTour(tourId),
      this.tourLanguageRepo?.listByTour(tourId) ?? [],
      this.placeTranslationRepo?.listByTour(tourId) ?? [],
    ]);
    // E1 — cần tối thiểu một điểm để mô phỏng trải nghiệm (route tự sinh được).
    if (places.length === 0) throw new TourNotPreviewableError({ places: true, route: false });

    const view = buildTourDetailView({ tour, places, route: routeCfg, langs, translations, lang });
    // Đánh dấu đây là bản xem thử nội bộ (không công khai) + lộ trạng thái để
    // client hiển thị nhãn "Xem thử — <trạng thái>".
    return { ...view, preview: true, status: tour.status };
  }
}
