// =========================================================
// UC04 / UC12 — a tourist asks to hear a tour in a language that is not available yet.
//   POST /api/tours/:id/translations/:lang             (public tour, no sign-in)
//   POST /api/tours/:id/restricted/translations/:lang  (restricted tour, unlocked tester; UC14)
// The places missing a fresh translation are translated once (EnsureTranslations: one AI call per
// tour and language, shared by concurrent requests) and kept for every later tourist. Returns the
// tour detail in that language (same view as GET /api/tours/:id?lang=).
//   - language the author turned on  -> text_source machine (fills the gaps of the author's language)
//   - any other supported language   -> text_source auto, only while tours.auto_translate is true
// Errors: 404 tour not available, 400 unsupported code, 403 auto_translate_disabled,
// 503 translation_unavailable (AI down, nothing cached for the missing places).
// =========================================================
import { Language } from '../../domain/value-objects/language.js';
import { TEXT_SOURCE } from '../../domain/entities/place-translation.js';
import { TourNotFoundError, AutoTranslateDisabledError } from '../../domain/errors/index.js';

export class TranslateTourForVisitor {
  /**
   * @param {{ tourRepo, tourLanguageRepo, translations, getPublicTour, getRestrictedTour? }} deps
   *   translations = EnsureTranslations; getPublicTour / getRestrictedTour build the returned view
   *   (and check public status / restricted access).
   */
  constructor({ tourRepo, tourLanguageRepo, translations, getPublicTour, getRestrictedTour = null }) {
    this.tourRepo = tourRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.translations = translations;
    this.getPublicTour = getPublicTour;
    this.getRestrictedTour = getRestrictedTour;
  }

  /** @param {{ id: string, lang: string }} input */
  async publicTour({ id, lang }) {
    const tour = await this.tourRepo.findPublicById(id);
    if (!tour) throw new TourNotFoundError('Tour không còn khả dụng');
    const code = await this.#ensure(tour, lang);
    return this.getPublicTour.execute({ id, lang: code });
  }

  /** @param {{ tourId: string, userId: string, lang: string }} input */
  async restrictedTour({ tourId, userId, lang }) {
    // Access check first (404 for anyone without access, as GET .../restricted).
    await this.getRestrictedTour.execute({ tourId, userId });
    const tour = await this.tourRepo.findById(tourId);
    const code = await this.#ensure(tour, lang);
    return this.getRestrictedTour.execute({ tourId, userId, lang: code });
  }

  async #ensure(tour, lang) {
    const code = new Language(lang).value; // 400 "Ngôn ngữ không hỗ trợ"
    if (code === tour.originalLanguage) return code;

    const langs = await this.tourLanguageRepo.listByTour(tour.id);
    const own = langs.find((l) => l.languageCode === code);
    if (!own && tour.autoTranslate === false) throw new AutoTranslateDisabledError();

    // Voice of that language, else the tour's voice (any configured row), else the default.
    const voiceRow = own?.gender ? own : langs.find((l) => l.gender);
    const voice = voiceRow ? { gender: voiceRow.gender, region: voiceRow.region ?? null } : null;
    await this.translations.execute({
      tour,
      lang: code,
      voice,
      textSource: own ? TEXT_SOURCE.MACHINE : TEXT_SOURCE.AUTO,
    });
    return code;
  }
}
