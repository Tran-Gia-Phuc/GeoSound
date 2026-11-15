// =========================================================
// UC12 (bước 3–9) — Đặt ngôn ngữ phụ + giọng TTS cho tour. Chỉ tác giả.
//   - tự dịch text gốc của từng điểm sang mỗi ngôn ngữ phụ (E1 nếu lỗi). Dịch
//     THEO LÔ: mỗi ngôn ngữ một lần gọi (translateMany) nếu adapter hỗ trợ.
//   - render TTS cho mọi ngôn ngữ (gốc + phụ) theo giọng đã chọn (E1 nếu lỗi)
//   - GIỮ bản dịch tác giả đã chỉnh tay (textSource='edited') khi lưu lại
//   - chỉ dịch điểm chưa có bản dịch hoặc bản dịch đã cũ (source_hash, EnsureTranslations)
//   - bật một ngôn ngữ khách đã yêu cầu dịch tự động → dùng lại bản 'auto' (thành 'machine')
//   - bỏ ngôn ngữ phụ → xóa ngôn ngữ đó và bản dịch của nó
// Ngôn ngữ gốc là nguồn; text gốc = mô tả điểm (UC10) — không dịch, chỉ TTS.
// #240 (CHATBOT_EVENTS_ENABLED): a public tour stays public -> tour.published is sent again (translations).
// =========================================================
import { Language } from '../../domain/value-objects/language.js';
import { TtsVoice } from '../../domain/value-objects/tts-voice.js';
import { TourLanguage } from '../../domain/entities/tour-language.js';
import { PlaceTranslation, TEXT_SOURCE } from '../../domain/entities/place-translation.js';
import { TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';
import { sourceHash } from '../../domain/i18n/source-hash.js';
import { buildLanguageConfig } from './get-language-config.js';
import { notifyTourPublished } from './notify-tour-catalog.js';
import { EnsureTranslations, synthesizeTts } from './ensure-translations.js';

export class SetTourLanguages {
  /** @param {{ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo, translator, ttsSynthesizer, catalog?, logger? }} deps */
  constructor({
    tourRepo,
    placeRepo,
    tourLanguageRepo,
    placeTranslationRepo,
    translator,
    ttsSynthesizer,
    catalog = null,
    logger = console,
  }) {
    this.catalog = catalog;
    this.logger = logger;
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
    this.translator = translator;
    this.ttsSynthesizer = ttsSynthesizer;
    this.ensure = new EnsureTranslations({ placeRepo, placeTranslationRepo, translator, ttsSynthesizer });
  }

  /** @param {{ authorId, tourId, secondary: string[], voice: { gender, region? } }} input */
  async execute({ authorId, tourId, secondary, voice }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const source = tour.originalLanguage;
    const ttsVoice = new TtsVoice(voice);

    // Chuẩn hóa ngôn ngữ phụ: hợp lệ, không trùng, khác ngôn ngữ gốc.
    const secCodes = [...new Set(secondary.map((c) => new Language(c).value))].filter(
      (c) => c !== source
    );
    const allCodes = [source, ...secCodes];

    // 1) Đồng bộ danh sách ngôn ngữ của tour.
    const existingLangs = await this.tourLanguageRepo.listByTour(tourId);
    const removed = existingLangs.map((l) => l.languageCode).filter((c) => !allCodes.includes(c));
    const langEntities = allCodes.map(
      (code) =>
        new TourLanguage({
          tourId,
          languageCode: code,
          isSource: code === source,
          gender: ttsVoice.gender,
          region: ttsVoice.region,
        })
    );
    await this.tourLanguageRepo.upsertMany(tourId, langEntities);
    if (removed.length) {
      await this.tourLanguageRepo.deleteLanguages(tourId, removed);
      await this.placeTranslationRepo.deleteByLanguages(tourId, removed);
    }

    // 2) Dịch theo lô: mỗi ngôn ngữ phụ một lần gọi, CHỈ các điểm chưa có bản dịch hoặc bản dịch
    //    đã cũ (mô tả đổi sau lần dịch trước) — bản còn đúng và bản chỉnh tay được giữ (E1 nếu lỗi).
    for (const code of secCodes) {
      await this.ensure.execute({ tour, lang: code, withTts: false });
    }

    // 2b) Render TTS từng điểm × từng ngôn ngữ theo giọng đã chọn (giọng có thể vừa đổi).
    const places = await this.placeRepo.listByTour(tourId);
    const rows = await this.placeTranslationRepo.listByTour(tourId);
    const index = new Map(rows.map((t) => [`${t.placeId}:${t.languageCode}`, t]));
    for (const place of places) {
      for (const code of allCodes) {
        const prev = index.get(`${place.id}:${code}`);
        const isSource = code === source;
        const text = isSource ? place.description : prev.text;
        const tts = await synthesizeTts(this.ttsSynthesizer, text, code, ttsVoice.toPublic());
        await this.placeTranslationRepo.upsert(
          new PlaceTranslation({
            id: prev?.id,
            placeId: place.id,
            languageCode: code,
            text,
            // A language the tourists already had as automatic translation is now the author's.
            textSource: isSource ? TEXT_SOURCE.SOURCE : prev.textSource === TEXT_SOURCE.AUTO ? TEXT_SOURCE.MACHINE : prev.textSource,
            sourceHash: isSource ? sourceHash(place.description) : prev.sourceHash,
            ttsUrl: tts.url,
            ttsPrerendered: tts.prerendered,
          })
        );
      }
    }

    // 3) Trả cấu hình mới.
    const [langs, translations] = await Promise.all([
      this.tourLanguageRepo.listByTour(tourId),
      this.placeTranslationRepo.listByTour(tourId),
    ]);
    await notifyTourPublished(this, tour);
    return buildLanguageConfig({ tour, langs, translations, places });
  }
}
