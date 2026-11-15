// =========================================================
// Dựng VIEW chi tiết tour dùng CHUNG cho trải nghiệm nghe (UC04):
//   - UC02 (GetPublicTour) — khách xem tour CÔNG KHAI
//   - UC13 (PreviewTour)   — tác giả xem thử tour CỦA MÌNH (mọi trạng thái)
// Thuần: nhận sẵn tour + places + route + cấu hình ngôn ngữ (UC12), trả payload
// giống nhau để client tái dùng một trình phát/bản đồ duy nhất.
// =========================================================
import { resolveVoiceLabel } from '../../domain/value-objects/voice.js';
import { effectiveRoute } from '../../domain/route/effective-route.js';
import { splitLanguagesByReadiness, autoLanguageCodes } from '../../domain/i18n/translation-status.js';
import { SUPPORTED_LANGUAGES } from '../../domain/value-objects/language.js';

// Why the view is not in the language the tourist asked for (UC04: never fall back silently).
export const FALLBACK_REASON = Object.freeze({
  NOT_SUPPORTED: 'not_supported', // code outside SUPPORTED_LANGUAGES
  NOT_TRANSLATED: 'not_translated', // supported, no full translation yet -> can be asked for
  AUTO_DISABLED: 'auto_disabled', // supported, no translation and the author turned auto off
});

/**
 * @param {{
 *   tour, places: any[], route?: { path, triggers, navAudios }|null,
 *   langs?: any[], translations?: any[], lang?: string,
 * }} input
 *   route = cấu hình UC11 đã lưu (null nếu chưa lưu) — phần thiếu được tự sinh
 *   (effectiveRoute) để chế độ GPS luôn có vùng kích hoạt.
 */
export function buildTourDetailView({ tour, places, route = null, langs = [], translations = [], lang }) {
  const source = tour.originalLanguage;

  // Ngôn ngữ khả dụng = cấu hình UC12 (gốc luôn có mặt) NHƯNG chỉ những ngôn ngữ
  // mọi điểm đã có bản dịch thật; còn lại nằm ở pendingLanguages (không cho chọn).
  // Plus the automatic translations tourists asked for (text_source auto), once complete.
  const configured = langs.map((l) => l.languageCode);
  if (!configured.includes(source)) configured.unshift(source);
  const { ready, pending: pendingLanguages } = splitLanguagesByReadiness({
    source,
    languages: configured,
    places,
    translations,
  });
  // Turning automatic translation off also hides the automatic translations made before.
  const autoTranslate = tour.autoTranslate !== false;
  const autoCodes = autoTranslate ? autoLanguageCodes(translations, configured) : [];
  const { ready: autoReady } = splitLanguagesByReadiness({ source, languages: autoCodes, places, translations });
  const availableLanguages = [...ready, ...autoReady];
  const languageKinds = Object.fromEntries(
    availableLanguages.map((c) => [c, c === source ? 'source' : autoReady.includes(c) ? 'auto' : 'author'])
  );
  // A supported language that is not available can be asked for (POST .../translations/:lang):
  // any one when the author allows it, otherwise only the author's own (pending) languages.
  const translatableLanguages = SUPPORTED_LANGUAGES.filter(
    (c) => !availableLanguages.includes(c) && (autoTranslate || configured.includes(c))
  );

  const requestedLanguage = lang || null;
  const selectedLanguage = availableLanguages.includes(lang) ? lang : source;
  let fallbackReason = null;
  if (requestedLanguage && requestedLanguage !== selectedLanguage) {
    if (!SUPPORTED_LANGUAGES.includes(requestedLanguage)) fallbackReason = FALLBACK_REASON.NOT_SUPPORTED;
    else if (translatableLanguages.includes(requestedLanguage)) fallbackReason = FALLBACK_REASON.NOT_TRANSLATED;
    else fallbackReason = FALLBACK_REASON.AUTO_DISABLED;
  }

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
    authorId: tour.authorId, // public: links the author page (UC18) and hides own-tour rating / report (UC05, UC06)
    averageRating: tour.averageRating,
    ratingCount: tour.ratingCount,
    placeCount: places.length,
    selectedLanguage,
    requestedLanguage,
    fallbackReason,
    availableLanguages,
    pendingLanguages,
    languageKinds,
    translatableLanguages,
    autoTranslate,
    voiceLabel,
    places: places.map((p) => localizePlace(p, selectedLanguage, source, txByPlace.get(p.id))),
    // Route cho bản đồ chi tiết + vùng kích hoạt cho trình phát (UC11).
    route: effectiveRoute({ places, config: route }),
    // Phần đánh giá/nhận xét — chờ UC05.
    reviews: [],
  };
}

// Text + audio của điểm theo ngôn ngữ chọn: ưu tiên audio người thật đúng ngôn
// ngữ gốc; còn lại dùng TTS (UC12). Chưa có TTS → audioUrl null.
// Not the source language: translationKind (author | auto) and originalText ("Xem bản gốc").
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
  if (selectedLanguage === source) {
    return { ...base, text: place.description, audioUrl: tx?.ttsUrl ?? null, audioSource: 'tts' };
  }
  return {
    ...base,
    text: tx?.text ?? place.description,
    audioUrl: tx?.ttsUrl ?? null,
    audioSource: 'tts',
    translationKind: tx?.textSource === 'auto' ? 'auto' : 'author',
    originalText: place.description,
  };
}
