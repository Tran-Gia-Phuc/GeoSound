// =========================================================
// UC12 (bước 3–9) — Đặt ngôn ngữ phụ + giọng TTS cho tour. Chỉ tác giả.
//   - tự dịch text gốc của từng điểm sang mỗi ngôn ngữ phụ (E1 nếu lỗi). Dịch
//     THEO LÔ: mỗi ngôn ngữ một lần gọi (translateMany) nếu adapter hỗ trợ.
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

    // 2a) Dịch theo lô: mỗi ngôn ngữ phụ một lần, chỉ các điểm cần dịch.
    const context = [tour.title, tour.city].filter(Boolean).join(' — ');
    const machine = new Map(); // placeId:code -> text dịch mới
    for (const code of secCodes) {
      const need = places.filter((p) => {
        const prev = priorIndex.get(`${p.id}:${code}`);
        return prev?.textSource !== TEXT_SOURCE.EDITED;
      });
      const texts = await this.#translateMany(need.map((p) => p.description), source, code, context);
      need.forEach((p, i) => machine.set(`${p.id}:${code}`, texts[i]));
    }

    // 2b) Lưu bản dịch + render TTS từng điểm × từng ngôn ngữ.
    for (const place of places) {
      for (const code of allCodes) {
        const prev = priorIndex.get(`${place.id}:${code}`);
        const { text, textSource } = this.#resolveText(place, code, source, prev, machine);
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

  // Ngôn ngữ gốc → text gốc (mô tả điểm); đã chỉnh tay → giữ; còn lại → bản vừa
  // dịch ở bước 2a.
  #resolveText(place, code, source, prev, machine) {
    if (code === source) return { text: place.description, textSource: TEXT_SOURCE.SOURCE };
    if (prev?.textSource === TEXT_SOURCE.EDITED) {
      return { text: prev.text, textSource: TEXT_SOURCE.EDITED };
    }
    return { text: machine.get(`${place.id}:${code}`), textSource: TEXT_SOURCE.MACHINE };
  }

  // Dịch nhiều đoạn sang MỘT ngôn ngữ. Adapter có translateMany (AI service) thì
  // gọi một lần; không thì dịch lần lượt. Lỗi → E1.
  async #translateMany(texts, from, to, context) {
    if (!texts.length) return [];
    try {
      if (typeof this.translator.translateMany === 'function') {
        const out = await this.translator.translateMany({ texts, from, to, context });
        if (!Array.isArray(out) || out.length !== texts.length) throw new Error('Số bản dịch không khớp');
        return out;
      }
      const out = [];
      for (const text of texts) out.push(await this.translator.translate({ text, from, to, context }));
      return out;
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
