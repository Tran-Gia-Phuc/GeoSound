// =========================================================
// UC12 / A2 — Chỉnh bản dịch của một điểm (tên riêng/thuật ngữ sai). Chỉ tác giả.
// Đánh dấu 'edited' (sẽ được giữ khi lưu lại cấu hình) và render lại TTS.
// Sửa text GỐC thì làm ở quản lý điểm (UC10) — không thuộc use case này.
// #240 (CHATBOT_EVENTS_ENABLED): a public tour stays public -> tour.published is sent again (translations).
// =========================================================
import { Language } from '../../domain/value-objects/language.js';
import { TtsVoice } from '../../domain/value-objects/tts-voice.js';
import { PlaceTranslation } from '../../domain/entities/place-translation.js';
import {
  TourNotFoundError,
  NotTourOwnerError,
  PlaceNotFoundError,
  ValidationError,
  TtsError,
} from '../../domain/errors/index.js';
import { notifyTourPublished } from './notify-tour-catalog.js';

export class UpdateTranslation {
  /** @param {{ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo, ttsSynthesizer, catalog?, logger? }} deps */
  constructor({ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo, ttsSynthesizer, catalog = null, logger = console }) {
    this.catalog = catalog;
    this.logger = logger;
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
    this.ttsSynthesizer = ttsSynthesizer;
  }

  /** @param {{ authorId, tourId, placeId, lang, text }} input */
  async execute({ authorId, tourId, placeId, lang, text }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const place = await this.placeRepo.findById(placeId);
    if (!place || place.tourId !== tourId) throw new PlaceNotFoundError();

    const code = new Language(lang).value;
    if (code === tour.originalLanguage) {
      throw new ValidationError('Sửa nội dung ngôn ngữ gốc ở phần quản lý điểm (UC10)');
    }
    const langs = await this.tourLanguageRepo.listByTour(tourId);
    const langRow = langs.find((l) => l.languageCode === code);
    if (!langRow) throw new ValidationError('Ngôn ngữ chưa được cấu hình cho tour');

    const existing = await this.placeTranslationRepo.findByPlaceLang(placeId, code);
    const tx =
      existing ??
      new PlaceTranslation({ placeId, languageCode: code, text, textSource: 'machine' });
    tx.applyEdit(text.trim()); // -> edited, xóa TTS cũ

    const voice = new TtsVoice({ gender: langRow.gender, region: langRow.region });
    let tts;
    try {
      tts = await this.ttsSynthesizer.synthesize({ text: tx.text, language: code, voice: voice.toPublic() });
    } catch {
      throw new TtsError(); // E1
    }
    tx.ttsUrl = tts.url;
    tx.ttsPrerendered = tts.prerendered;

    const saved = await this.placeTranslationRepo.upsert(tx);
    await notifyTourPublished(this, tour);
    return saved.toPublic();
  }
}
