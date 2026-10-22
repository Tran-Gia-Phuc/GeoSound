// =========================================================
// UC12 (bước 1–2, 6) — Lấy cấu hình ngôn ngữ & giọng của tour. Chỉ tác giả.
// Chưa cấu hình → chỉ có ngôn ngữ gốc, chưa có ngôn ngữ phụ/bản dịch.
// =========================================================
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';

/** Ráp cấu hình trả về từ các mảnh đã tải (dùng chung với SetTourLanguages). */
export function buildLanguageConfig({ tour, langs, translations, places }) {
  const source = tour.originalLanguage;
  const voice = langs.find((l) => l.gender)?.toPublic().voice ?? null;

  // Ngôn ngữ: luôn gồm ngôn ngữ gốc (kể cả khi chưa lưu TourLanguage nào).
  const languages = langs.length
    ? langs.map((l) => l.toPublic())
    : [{ languageCode: source, isSource: true, voice: null }];

  const byPlace = new Map(places.map((p) => [p.id, []]));
  for (const t of translations) {
    if (byPlace.has(t.placeId)) byPlace.get(t.placeId).push(t.toPublic());
  }

  return {
    tourId: tour.id,
    sourceLanguage: source,
    voice,
    languages,
    places: places.map((p) => ({
      placeId: p.id,
      name: p.name,
      translations: byPlace.get(p.id) ?? [],
    })),
  };
}

export class GetLanguageConfig {
  /** @param {{ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo }} deps */
  constructor({ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
  }

  /** @param {{ authorId, tourId }} input */
  async execute({ authorId, tourId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const [langs, translations, places] = await Promise.all([
      this.tourLanguageRepo.listByTour(tourId),
      this.placeTranslationRepo.listByTour(tourId),
      this.placeRepo.listByTour(tourId),
    ]);
    return buildLanguageConfig({ tour, langs, translations, places });
  }
}
