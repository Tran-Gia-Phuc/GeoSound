// =========================================================
// Listening languages (UC04 / UC12): the supported list (same as the Tour service and the AI
// service), the device language, and the Vietnamese texts for a language that is not served.
// =========================================================
import { langLabel } from './format.js';

export const SUPPORTED_LANGUAGES = Object.freeze(['vi', 'en', 'fr', 'ja', 'ko', 'zh', 'es', 'de', 'th', 'ru']);

/**
 * First supported language of the device ('en-US' -> 'en'), or null.
 * @param {{ languages?: readonly string[], language?: string }} [nav]
 */
export function deviceLanguage(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  const list = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  for (const tag of list) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED_LANGUAGES.includes(base)) return base;
  }
  return null;
}

/**
 * Why the tour is not in the language that was asked for (detail.fallbackReason), or null.
 * @param {{ fallbackReason?: string|null, requestedLanguage?: string|null, selectedLanguage: string }} tour
 * @param {boolean} canTranslate the page can ask for an automatic translation
 */
export function fallbackText(tour, canTranslate) {
  const asked = tour?.requestedLanguage;
  const playing = langLabel(tour?.selectedLanguage);
  switch (tour?.fallbackReason) {
    case 'not_supported':
      return `GeoSound chưa hỗ trợ ngôn ngữ "${asked}". Đang phát ${playing}.`;
    case 'auto_disabled':
      return `Tác giả chưa cho phép dịch tự động sang ${langLabel(asked)}. Đang phát ${playing}.`;
    case 'not_translated':
      return canTranslate
        ? `Tour chưa có bản ${langLabel(asked)}. Bạn có thể yêu cầu dịch tự động.`
        : `Tour chưa có bản ${langLabel(asked)}. Đang phát ${playing}.`;
    default:
      return null;
  }
}

/** Message for a failed POST .../translations/:lang. */
export function translationErrorText(e) {
  if (e?.offline) return 'Mất kết nối mạng. Vui lòng thử lại khi có mạng.';
  if (e?.status === 429) return 'Bạn yêu cầu dịch quá nhiều lần. Vui lòng thử lại sau ít phút.';
  if (e?.status === 403) return 'Tác giả chưa cho phép dịch tự động tour này.';
  if (e?.status === 503) return 'Dịch tự động đang bận. Vui lòng thử lại sau.';
  return e?.message || 'Không dịch được tour. Vui lòng thử lại.';
}

// "Để sau" on the device language suggestion: remembered per tour and language on this device.
const DISMISS_KEY = 'geosound:lang-offer-dismissed';

export function isOfferDismissed(tourId, code) {
  try {
    return (JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') || []).includes(`${tourId}:${code}`);
  } catch {
    return false;
  }
}

export function dismissOffer(tourId, code) {
  try {
    const list = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') || [];
    if (!list.includes(`${tourId}:${code}`)) list.push(`${tourId}:${code}`);
    localStorage.setItem(DISMISS_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* storage blocked: the suggestion comes back next time */
  }
}
