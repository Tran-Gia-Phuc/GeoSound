// =========================================================
// Dựng VIEW chi tiết tour dùng CHUNG cho trải nghiệm nghe (UC04):
//   - UC02 (GetPublicTour) — khách xem tour CÔNG KHAI
//   - UC13 (PreviewTour)   — tác giả xem thử tour CỦA MÌNH (mọi trạng thái)
// Thuần: nhận sẵn tour + places + route + cấu hình ngôn ngữ (UC12), trả payload
// giống nhau để client tái dùng một trình phát/bản đồ duy nhất.
// =========================================================
import { resolveVoiceLabel } from '../../domain/value-objects/voice.js';

/**
 * @param {{
 *   tour, places: any[], route: { path, triggers, navAudios },
 *   langs?: any[], translations?: any[], lang?: string,
 * }} input
 */
export function buildTourDetailView({ tour, places, route, langs = [], translations = [], lang }) {
  const source = tour.originalLanguage;

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
