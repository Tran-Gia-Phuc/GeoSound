// =========================================================
// UC02 (bước 6–9, A2) — Xem chi tiết tour CÔNG KHAI. Không cần đăng nhập.
// Trả: thông tin tour, số điểm, route (bản đồ), điểm đánh giá, nhãn giọng,
// ngôn ngữ nghe (đổi ngôn ngữ cập nhật nhãn giọng + text/audio). E3: tour không
// công khai (nháp/ẩn/xóa/hạn chế) → không tìm thấy (404).
// Ngôn ngữ & TTS lấy từ cấu hình UC12: availableLanguages = ngôn ngữ đã cấu hình
// (gốc + phụ), mỗi điểm có text + audio theo ngôn ngữ đang chọn (ưu tiên audio
// người thật đúng ngôn ngữ gốc; còn lại dùng TTS). Reviews chờ UC05.
// =========================================================
import { RouteConfig } from '../../domain/entities/route-config.js';
import { resolveVoiceLabel } from '../../domain/value-objects/voice.js';
import { TourNotFoundError } from '../../domain/errors/index.js';

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
    const source = tour.originalLanguage;

    const [places, routeCfg, langs, translations] = await Promise.all([
      this.placeRepo.listByTour(id),
      this.routeConfigRepo.findByTour(id),
      this.tourLanguageRepo?.listByTour(id) ?? [],
      this.placeTranslationRepo?.listByTour(id) ?? [],
    ]);
    const route = routeCfg ?? RouteConfig.empty(id);

    // Ngôn ngữ khả dụng = cấu hình UC12 (gốc luôn có mặt).
    const configured = langs.map((l) => l.languageCode);
    const availableLanguages = configured.length ? configured : [source];
    if (!availableLanguages.includes(source)) availableLanguages.unshift(source);
    const selectedLanguage = availableLanguages.includes(lang) ? lang : source;

    const hasHumanAudioOriginal = places.some((p) => p.audioSource === 'human');
    const voiceLabel = resolveVoiceLabel({
      selectedLanguage,
      originalLanguage: source,
      hasHumanAudioOriginal,
    });

    // Bản dịch/TTS theo ngôn ngữ đang chọn, tra theo điểm.
    const txByPlace = new Map();
    for (const t of translations) {
      if (t.languageCode === selectedLanguage) txByPlace.set(t.placeId, t);
    }

    return {
      id: tour.id,
      title: tour.title,
      description: tour.description,
      coverImageUrl: tour.coverImageUrl,
      city: tour.city,
      type: tour.type,
      originalLanguage: source,
      duration: tour.duration,
      averageRating: tour.averageRating,
      ratingCount: tour.ratingCount,
      placeCount: places.length,
      selectedLanguage,
      availableLanguages,
      voiceLabel,
      places: places.map((p) => localizePlace(p, selectedLanguage, source, txByPlace.get(p.id))),
      // Route cho bản đồ chi tiết (UC11).
      route: { path: route.path, triggers: route.triggers, navAudios: route.navAudios },
      // Phần đánh giá/nhận xét — chờ UC05.
      reviews: [],
    };
  }
}

// Text + audio của điểm theo ngôn ngữ chọn: ưu tiên audio người thật đúng ngôn
// ngữ gốc; còn lại dùng TTS (UC12). Chưa có TTS → audioUrl null.
function localizePlace(place, selectedLanguage, source, tx) {
  const base = {
    id: place.id,
    name: place.name,
    type: place.type,
    lat: place.lat,
    lng: place.lng,
    sequence: place.sequence,
    images: place.images,
  };
  if (selectedLanguage === source && place.audioSource === 'human' && place.audioUrl) {
    return { ...base, text: place.description, audioUrl: place.audioUrl, audioSource: 'human' };
  }
  const text = selectedLanguage === source ? place.description : tx?.text ?? place.description;
  return { ...base, text, audioUrl: tx?.ttsUrl ?? null, audioSource: 'tts' };
}
