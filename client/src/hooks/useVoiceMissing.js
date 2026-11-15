// =========================================================
// useVoiceMissing (UC04 / UC12) — true when the device lists its speech voices and none of them
// speaks `lang`: the text of a stop without an audio file cannot be read aloud, only shown.
// False while the list is empty or unknown (Chrome loads voices late: 'voiceschanged').
// =========================================================
import { useEffect, useState } from 'react';
import { pickVoice } from '../lib/speech.js';

function check(lang) {
  if (!lang || typeof window === 'undefined' || !('speechSynthesis' in window) || !window.speechSynthesis) return false;
  let voices = [];
  try {
    voices = window.speechSynthesis.getVoices() || [];
  } catch {
    return false;
  }
  return voices.length > 0 && !pickVoice(lang);
}

/** @param {string|undefined} lang */
export function useVoiceMissing(lang) {
  const [missing, setMissing] = useState(() => check(lang));
  useEffect(() => {
    setMissing(check(lang));
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth?.addEventListener) return undefined;
    const update = () => setMissing(check(lang));
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, [lang]);
  return missing;
}
