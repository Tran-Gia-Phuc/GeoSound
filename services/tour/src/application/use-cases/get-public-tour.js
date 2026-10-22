// =========================================================
// UC02 (bước 6–9, A2) — Xem chi tiết tour CÔNG KHAI. Không cần đăng nhập.
// Trả: thông tin tour, số điểm, route (bản đồ), điểm đánh giá, nhãn giọng,
// ngôn ngữ nghe (đổi ngôn ngữ cập nhật nhãn giọng). E3: tour không công khai
// (nháp/ẩn/xóa/hạn chế) → không tìm thấy (404).
// Hiện chỉ có audio ngôn ngữ gốc (đa ngôn ngữ ở UC12) nên availableLanguages
// chỉ gồm ngôn ngữ gốc; phần đánh giá (reviews) chờ UC05.
// =========================================================
import { RouteConfig } from '../../domain/entities/route-config.js';
import { resolveVoiceLabel } from '../../domain/value-objects/voice.js';
import { TourNotFoundError } from '../../domain/errors/index.js';

export class GetPublicTour {
  /** @param {{ tourRepo, placeRepo, routeConfigRepo }} deps */
  constructor({ tourRepo, placeRepo, routeConfigRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.routeConfigRepo = routeConfigRepo;
  }

  /** @param {{ id: string, lang?: string }} input */
  async execute({ id, lang }) {
    const tour = await this.tourRepo.findPublicById(id);
    if (!tour) throw new TourNotFoundError('Tour không còn khả dụng'); // E3

    const [places, routeCfg] = await Promise.all([
      this.placeRepo.listByTour(id),
      this.routeConfigRepo.findByTour(id),
    ]);
    const route = routeCfg ?? RouteConfig.empty(id);

    const hasHumanAudioOriginal = places.some((p) => p.audioSource === 'human');
    // Chỉ có audio ngôn ngữ gốc cho tới khi làm UC12.
    const availableLanguages = [tour.originalLanguage];
    const selectedLanguage = availableLanguages.includes(lang) ? lang : tour.originalLanguage;
    const voiceLabel = resolveVoiceLabel({
      selectedLanguage,
      originalLanguage: tour.originalLanguage,
      hasHumanAudioOriginal,
    });

    return {
      id: tour.id,
      title: tour.title,
      description: tour.description,
      coverImageUrl: tour.coverImageUrl,
      city: tour.city,
      type: tour.type,
      originalLanguage: tour.originalLanguage,
      duration: tour.duration,
      averageRating: tour.averageRating,
      ratingCount: tour.ratingCount,
      placeCount: places.length,
      selectedLanguage,
      availableLanguages,
      voiceLabel,
      places: places.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        lat: p.lat,
        lng: p.lng,
        sequence: p.sequence,
        images: p.images,
        audioSource: p.audioSource,
      })),
      // Route cho bản đồ chi tiết (UC11).
      route: { path: route.path, triggers: route.triggers, navAudios: route.navAudios },
      // Phần đánh giá/nhận xét — chờ UC05.
      reviews: [],
    };
  }
}
