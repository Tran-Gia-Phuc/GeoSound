// =========================================================
// Listening languages (UC04 / UC12): the supported list, the device language, and the Vietnamese
// texts for a language that is not served. The list belongs to the Tour service (SUPPORTED_LANGUAGES,
// #425): loaded from GET /api/tours/languages, kept in localStorage for offline use.
// =========================================================
import { api } from './api.js';
import { langLabel } from './format.js';

/** Used before the first answer of the server and when it cannot be reached. */
export const DEFAULT_LANGUAGES = Object.freeze(['vi', 'en', 'fr', 'ja', 'ko', 'zh', 'es', 'de', 'th', 'ru']);

const CACHE_KEY = 'geosound:languages';
const CODE = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/;

/** Valid, lower-cased, unique codes of an untrusted list; null when none. */
function cleanList(list) {
  if (!Array.isArray(list)) return null;
  const codes = [...new Set(list.map((c) => String(c ?? '').trim().toLowerCase()).filter((c) => CODE.test(c)))];
  return codes.length ? codes : null;
}

let current = null;
let loading = null;

/** The list known now: the last one loaded (this tab, then localStorage), else the default. */
export function supportedLanguages() {
  if (current) return current;
  try {
    current = cleanList(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'));
  } catch {
    current = null;
  }
  return current || DEFAULT_LANGUAGES;
}

/**
 * Loads the list once per page load. Never rejects: on any error it resolves to the known list.
 * @returns {Promise<readonly string[]>}
 */
export function loadSupportedLanguages() {
  loading ??= api
    .get('/api/tours/languages')
    .then((body) => {
      const codes = cleanList(body?.languages);
      if (!codes) return supportedLanguages();
      current = Object.freeze(codes);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(codes));
      } catch {
        /* storage blocked: loaded again next time */
      }
      return current;
    })
    .catch(() => {
      loading = null; // try again on the next screen
      return supportedLanguages();
    });
  return loading;
}

/** Select options { value, label } for a list of codes (label = native name). */
export function languageOptions(codes = supportedLanguages()) {
  return codes.map((value) => ({ value, label: langLabel(value) }));
}

/**
 * First supported language of the device: the full tag first ('zh-TW' -> 'zh-tw' when listed),
 * then the base language ('en-US' -> 'en'). Null when none.
 * @param {{ languages?: readonly string[], language?: string }} [nav]
 * @param {readonly string[]} [supported]
 */
export function deviceLanguage(nav = typeof navigator !== 'undefined' ? navigator : undefined, supported = supportedLanguages()) {
  const list = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  for (const tag of list) {
    const full = String(tag || '').toLowerCase().replace('_', '-');
    if (supported.includes(full)) return full;
    const base = full.split('-')[0];
    if (supported.includes(base)) return base;
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
