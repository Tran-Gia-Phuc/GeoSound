// =========================================================
// UC12 (#425) — the listening languages of this deployment (Tour service SUPPORTED_LANGUAGES).
// Starts with the known list (localStorage or the default) and updates when the server answers.
// =========================================================
import { useEffect, useMemo, useState } from 'react';
import { languageOptions, loadSupportedLanguages, supportedLanguages } from '../lib/languages.js';

/** @returns {{ languages: readonly string[], options: { value: string, label: string }[] }} */
export function useSupportedLanguages() {
  const [languages, setLanguages] = useState(supportedLanguages);
  useEffect(() => {
    let alive = true;
    loadSupportedLanguages().then((list) => {
      if (alive) setLanguages(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  const options = useMemo(() => languageOptions(languages), [languages]);
  return { languages, options };
}
