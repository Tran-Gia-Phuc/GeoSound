// =========================================================
// UC02 (bước 6–9, A2) — Xem chi tiết tour CÔNG KHAI. Không cần đăng nhập.
// Trả: thông tin tour, số điểm, route (bản đồ), điểm đánh giá, nhãn giọng,
// ngôn ngữ nghe (đổi ngôn ngữ cập nhật nhãn giọng + text/audio). E3: tour không
// công khai (nháp/ẩn/xóa/hạn chế) → không tìm thấy (404).
// Ngôn ngữ & TTS lấy từ cấu hình UC12: availableLanguages = ngôn ngữ đã cấu hình
// (gốc + phụ), mỗi điểm có text + audio theo ngôn ngữ đang chọn (ưu tiên audio
// người thật đúng ngôn ngữ gốc; còn lại dùng TTS). Reviews chờ UC05.
// =========================================================
import { TourNotFoundError } from '../../domain/errors/index.js';
import { buildTourDetailView } from './build-tour-detail.js';

export class GetPublicTour {
  /** @param {{ tourRepo, placeRepo, routeConfigRepo, tourLanguageRepo?, placeTranslationRepo? }} deps */
  constructor({ tourRepo, placeRepo, routeConfigRepo, tourLanguageRepo, placeTranslationRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.routeConfigRepo = routeConfigRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
  }

  /** @param {{ id: string, lang?: string }} input */
  async execute({ id, lang }) {
    const tour = await this.tourRepo.findPublicById(id);
    if (!tour) throw new TourNotFoundError('Tour không còn khả dụng'); // E3

    const [places, routeCfg, langs, translations] = await Promise.all([
      this.placeRepo.listByTour(id),
      this.routeConfigRepo.findByTour(id),
      this.tourLanguageRepo?.listByTour(id) ?? [],
      this.placeTranslationRepo?.listByTour(id) ?? [],
    ]);
    // Chưa cấu hình route → buildTourDetailView tự sinh route + vùng mặc định.
    return buildTourDetailView({ tour, places, route: routeCfg, langs, translations, lang });
  }
}
