// =========================================================
// UC12 (bước 3–9) — Đặt ngôn ngữ phụ + giọng TTS cho tour. Chỉ tác giả.
//   - tự dịch text gốc của từng điểm sang mỗi ngôn ngữ phụ (E1 nếu lỗi)
//   - render TTS cho mọi ngôn ngữ (gốc + phụ) theo giọng đã chọn (E1 nếu lỗi)
//   - GIỮ bản dịch tác giả đã chỉnh tay (textSource='edited') khi lưu lại
//   - bỏ ngôn ngữ phụ → xóa ngôn ngữ đó và bản dịch của nó
// Ngôn ngữ gốc là nguồn; text gốc = mô tả điểm (UC10) — không dịch, chỉ TTS.
// =========================================================
import { Language } from '../../domain/value-objects/language.js';
import { TtsVoice } from '../../domain/value-objects/tts-voice.js';
import { TourLanguage } from '../../domain/entities/tour-language.js';
import { PlaceTranslation, TEXT_SOURCE } from '../../domain/entities/place-translation.js';
import {
  TourNotFoundError,
  NotTourOwnerError,
  TranslationError,
  TtsError,
} from '../../domain/errors/index.js';
import { buildLanguageConfig } from './get-language-config.js';

export class SetTourLanguages {
  /** @param {{ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo, translator, ttsSynthesizer }} deps */
  constructor({ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo, translator, ttsSynthesizer }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
    this.translator = translator;
    this.ttsSynthesizer = ttsSynthesizer;
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

    // 2) Dịch + render TTS từng điểm × từng ngôn ngữ.
    const places = await this.placeRepo.listByTour(tourId);
    const prior = await this.placeTranslationRepo.listByTour(tourId);
    const priorIndex = new Map(prior.map((t) => [`${t.placeId}:${t.languageCode}`, t]));

    for (const place of places) {
      for (const code of allCodes) {
        const prev = priorIndex.get(`${place.id}:${code}`);
        const { text, textSource } = await this.#resolveText(place, code, source, prev);
        const tts = await this.#synthesize(text, code, ttsVoice);

        await this.placeTranslationRepo.upsert(
          new PlaceTranslation({
            id: prev?.id,
            placeId: place.id,
            languageCode: code,
            text,
            textSource,
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
    return buildLanguageConfig({ tour, langs, translations, places });
  }

  // Ngôn ngữ gốc → text gốc (mô tả điểm); đã chỉnh tay → giữ; còn lại → dịch (E1).
  async #resolveText(place, code, source, prev) {
    if (code === source) return { text: place.description, textSource: TEXT_SOURCE.SOURCE };
    if (prev?.textSource === TEXT_SOURCE.EDITED) {
      return { text: prev.text, textSource: TEXT_SOURCE.EDITED };
    }
    try {
      const text = await this.translator.translate({ text: place.description, from: source, to: code });
      return { text, textSource: TEXT_SOURCE.MACHINE };
    } catch {
      throw new TranslationError(); // E1
    }
  }

  async #synthesize(text, code, ttsVoice) {
    try {
      return await this.ttsSynthesizer.synthesize({ text, language: code, voice: ttsVoice.toPublic() });
    } catch {
      throw new TtsError(); // E1
    }
  }
}
