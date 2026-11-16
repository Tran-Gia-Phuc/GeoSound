// =========================================================
// Web Speech helpers shared by the tour player and the quick preview (#263).
//   - speechLang(): 'vi' -> 'vi-VN' (Android picks no voice for a bare code)
//   - pickVoice(): an installed voice for that language, when there is one
//   - pauseStopsSpeech(): on Android Chrome speechSynthesis.pause() ends the utterance
//     instead of pausing it, so the desktop pause/resume tricks must not run there.
// =========================================================

const LANG_TAGS = {
  vi: 'vi-VN', en: 'en-US', fr: 'fr-FR', ja: 'ja-JP', ko: 'ko-KR',
  zh: 'zh-CN', es: 'es-ES', de: 'de-DE', th: 'th-TH', ru: 'ru-RU',
  // Codes added through SUPPORTED_LANGUAGES (#428); 'zh-tw' needs no entry (region rule below).
  id: 'id-ID', ms: 'ms-MY', it: 'it-IT', pt: 'pt-BR', nl: 'nl-NL',
  pl: 'pl-PL', tr: 'tr-TR', hi: 'hi-IN', sv: 'sv-SE',
};

/** Full BCP 47 tag for a language code ('vi' -> 'vi-VN'); other values unchanged. */
export function speechLang(code) {
  if (!code) return '';
  const value = String(code);
  const tag = LANG_TAGS[value.toLowerCase()];
  if (tag) return tag;
  // A configured code with a region ('zh-tw', #425) -> 'zh-TW'.
  const m = /^([a-z]{2,3})[-_]([a-z]{2})$/i.exec(value);
  return m ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : value;
}

/** Installed voice for the language: exact tag first, then same base language. Null when none. */
export function pickVoice(lang) {
  if (!lang || typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  let voices = [];
  try {
    voices = window.speechSynthesis.getVoices() || [];
  } catch {
    return null;
  }
  const tag = speechLang(lang).toLowerCase().replace('_', '-');
  const base = tag.split('-')[0];
  const norm = (v) => String(v.lang || '').toLowerCase().replace('_', '-');
  return voices.find((v) => norm(v) === tag) || voices.find((v) => norm(v).split('-')[0] === base) || null;
}

/** True where speechSynthesis.pause() cancels speech (Android Chrome). */
export function pauseStopsSpeech() {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
}

/** Builds an utterance with the right language and voice. */
export function makeUtterance(text, lang) {
  const u = new SpeechSynthesisUtterance(text);
  const tag = speechLang(lang);
  if (tag) u.lang = tag;
  const voice = pickVoice(tag);
  if (voice) {
    try {
      u.voice = voice;
    } catch {
      /* not a SpeechSynthesisVoice: keep the language only */
    }
  }
  return u;
}

// Voices load asynchronously on Chrome: ask once early so pickVoice() finds them on the first tap.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try {
    window.speechSynthesis.getVoices();
  } catch {
    /* ignore */
  }
}
