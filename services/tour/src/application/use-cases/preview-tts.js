// =========================================================
// UC12 / A1 — Nghe thử TTS của một điểm theo một ngôn ngữ. Chỉ tác giả.
// Có bản TTS sẵn → trả URL; chưa có → render theo giọng của ngôn ngữ đó rồi lưu.
// =========================================================
import { Language } from '../../domain/value-objects/language.js';
import { TtsVoice } from '../../domain/value-objects/tts-voice.js';
import { PlaceTranslation, TEXT_SOURCE } from '../../domain/entities/place-translation.js';
import {
  TourNotFoundError,
  NotTourOwnerError,
  PlaceNotFoundError,
  ValidationError,
  TtsError,
} from '../../domain/errors/index.js';

export class PreviewTts {
  /** @param {{ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo, ttsSynthesizer }} deps */
  constructor({ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo, ttsSynthesizer }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
    this.ttsSynthesizer = ttsSynthesizer;
  }

  /** @param {{ authorId, tourId, placeId, lang }} input */
  async execute({ authorId, tourId, placeId, lang }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const place = await this.placeRepo.findById(placeId);
    if (!place || place.tourId !== tourId) throw new PlaceNotFoundError();

    const code = new Language(lang).value;
    const langs = await this.tourLanguageRepo.listByTour(tourId);
    const langRow = langs.find((l) => l.languageCode === code);
    if (!langRow) throw new ValidationError('Ngôn ngữ chưa được cấu hình cho tour');

    const existing = await this.placeTranslationRepo.findByPlaceLang(placeId, code);
    if (existing?.ttsUrl) {
      return { placeId, language: code, url: existing.ttsUrl, prerendered: existing.ttsPrerendered };
    }

    // Chưa có TTS → render từ text hiện có (text gốc nếu là ngôn ngữ gốc).
    const text = existing?.text ?? place.description;
    const voice = new TtsVoice({ gender: langRow.gender, region: langRow.region });
    let tts;
    try {
      tts = await this.ttsSynthesizer.synthesize({ text, language: code, voice: voice.toPublic() });
    } catch {
      throw new TtsError(); // E1
    }

    const saved = await this.placeTranslationRepo.upsert(
      new PlaceTranslation({
        id: existing?.id,
        placeId,
        languageCode: code,
        text,
        textSource: existing?.textSource ?? (code === tour.originalLanguage ? TEXT_SOURCE.SOURCE : TEXT_SOURCE.MACHINE),
        ttsUrl: tts.url,
        ttsPrerendered: tts.prerendered,
      })
    );
    return { placeId, language: code, url: saved.ttsUrl, prerendered: saved.ttsPrerendered };
  }
}
