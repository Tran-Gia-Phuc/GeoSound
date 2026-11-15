// =========================================================
// UC07 — Dựng SNAPSHOT một địa điểm để thêm vào lịch trình cá nhân.
// Gộp text + audio theo MỌI ngôn ngữ khả dụng của tour (UC12) để item tự chứa,
// phục vụ phát lại (UC08) và chia sẻ/offline (A3/A4) độc lập với tour gốc.
// Quy tắc audio giống build-tour-detail: ưu tiên audio người thật ở ngôn ngữ
// gốc; còn lại dùng TTS (audioUrl có thể null nếu chưa render).
// =========================================================
import { ItineraryItem } from '../../domain/entities/itinerary-item.js';

/**
 * @param {{
 *   place: import('../../domain/entities/place.js').Place,
 *   sourceLanguage: string,
 *   langs?: Array<{ languageCode: string }>,
 *   translations?: Array<{ placeId: string, languageCode: string, text: string, ttsUrl: string|null }>,
 *   radiusMeters?: number,
 * }} input
 * @returns {ItineraryItem}
 */
export function snapshotPlace({ place, sourceLanguage, langs = [], translations = [], radiusMeters }) {
  const configured = langs.map((l) => l.languageCode);
  const availableLanguages = configured.length ? [...configured] : [sourceLanguage];
  if (!availableLanguages.includes(sourceLanguage)) availableLanguages.unshift(sourceLanguage);

  // Bản dịch của CHÍNH điểm này, tra theo ngôn ngữ.
  const txByLang = new Map();
  for (const t of translations) {
    if (t.placeId === place.id) txByLang.set(t.languageCode, t);
  }

  const audioByLang = {};
  for (const lang of availableLanguages) {
    if (lang === sourceLanguage && place.audioSource === 'human' && place.audioUrl) {
      audioByLang[lang] = { text: place.description, audioUrl: place.audioUrl, audioSource: 'human' };
      continue;
    }
    const tx = txByLang.get(lang);
    const text = lang === sourceLanguage ? place.description : tx?.text ?? place.description;
    audioByLang[lang] = { text, audioUrl: tx?.ttsUrl ?? null, audioSource: 'tts' };
  }

  return new ItineraryItem({
    placeId: place.id,
    tourId: place.tourId,
    name: place.name,
    type: place.type,
    lat: place.lat,
    lng: place.lng,
    images: place.images,
    radiusMeters,
    sourceLanguage,
    availableLanguages,
    audioByLang,
  });
}
