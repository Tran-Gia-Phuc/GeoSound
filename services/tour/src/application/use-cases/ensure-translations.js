// =========================================================
// UC12 / UC10 — make sure the places of a tour have a fresh translation in one language.
// Only the places that need it are sent to the translator (missing, empty, copy of the source,
// or made from an older description: domain/i18n/translation-status needsTranslation), in ONE
// translateMany call. Edited translations are never replaced. The source language is not
// translated: its row text is the place description.
// Used by SetTourLanguages (author saves languages), AddPlace / UpdatePlace (a new place or a
// changed description refreshes the tour's languages at once, best effort) and
// TranslateTourForVisitor (a tourist asks for a language: text_source auto when the author did not
// turn it on). Concurrent calls for the same tour, language and places share one run (single
// flight, one Tour instance), so ten tourists asking at once cost one AI call.
// Errors: translator -> TranslationError (E1, 503), TTS -> TtsError (E1, 503).
// =========================================================
import { PlaceTranslation, TEXT_SOURCE } from '../../domain/entities/place-translation.js';
import { TranslationError, TtsError } from '../../domain/errors/index.js';
import { needsTranslation } from '../../domain/i18n/translation-status.js';
import { sourceHash } from '../../domain/i18n/source-hash.js';

const DEFAULT_VOICE = Object.freeze({ gender: 'female', region: null });

/**
 * Dịch nhiều đoạn sang MỘT ngôn ngữ. Adapter có translateMany (AI service) thì gọi một lần;
 * không thì dịch lần lượt. Lỗi → E1.
 */
export async function translateTexts(translator, texts, from, to, context) {
  if (!texts.length) return [];
  try {
    if (typeof translator.translateMany === 'function') {
      const out = await translator.translateMany({ texts, from, to, context });
      if (!Array.isArray(out) || out.length !== texts.length) throw new Error('Số bản dịch không khớp');
      return out;
    }
    const out = [];
    for (const text of texts) out.push(await translator.translate({ text, from, to, context }));
    return out;
  } catch {
    throw new TranslationError(); // E1
  }
}

/** TTS of one text. Lỗi → E1. */
export async function synthesizeTts(ttsSynthesizer, text, language, voice) {
  try {
    return await ttsSynthesizer.synthesize({ text, language, voice: voice ?? DEFAULT_VOICE });
  } catch {
    throw new TtsError(); // E1
  }
}

export class EnsureTranslations {
  /** @param {{ placeRepo, placeTranslationRepo, translator, ttsSynthesizer }} deps */
  constructor({ placeRepo, placeTranslationRepo, translator, ttsSynthesizer }) {
    this.placeRepo = placeRepo;
    this.placeTranslationRepo = placeTranslationRepo;
    this.translator = translator;
    this.ttsSynthesizer = ttsSynthesizer;
    this.inflight = new Map(); // key -> Promise
  }

  /**
   * @param {{ tour, lang: string, voice?: { gender: string, region: string|null }|null,
   *           placeIds?: string[], withTts?: boolean, textSource?: 'machine'|'auto' }} input
   *   withTts=false: rows are saved without TTS (the caller renders it afterwards).
   *   textSource: label of the new rows (auto = asked by a tourist, language not turned on).
   * @returns {Promise<{ translated: number }>} number of rows written
   */
  execute(input) {
    const key = [input.tour.id, input.lang, input.textSource ?? 'machine', input.withTts === false ? 'notts' : 'tts', input.placeIds?.join(',') ?? '*'].join('|');
    const running = this.inflight.get(key);
    if (running) return running;
    const run = this.#run(input).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  async #run({ tour, lang, voice = null, placeIds, withTts = true, textSource = TEXT_SOURCE.MACHINE }) {
    const source = tour.originalLanguage;
    let places = await this.placeRepo.listByTour(tour.id);
    if (placeIds) places = places.filter((p) => placeIds.includes(p.id));
    const prior = await this.placeTranslationRepo.listByTour(tour.id);
    const byPlace = new Map(prior.filter((t) => t.languageCode === lang).map((t) => [t.placeId, t]));

    let need;
    let texts;
    if (lang === source) {
      // Source row = the description itself; only rewrite rows that no longer match it.
      need = places.filter((p) => {
        const prev = byPlace.get(p.id);
        return !prev || prev.text !== p.description || prev.sourceHash !== sourceHash(p.description);
      });
      texts = need.map((p) => p.description);
    } else {
      need = places.filter((p) => needsTranslation(p, byPlace.get(p.id)));
      const context = [tour.title, tour.city].filter(Boolean).join(' — ');
      texts = await translateTexts(this.translator, need.map((p) => p.description), source, lang, context);
    }

    for (const [i, place] of need.entries()) {
      const prev = byPlace.get(place.id);
      const tts = withTts ? await synthesizeTts(this.ttsSynthesizer, texts[i], lang, voice) : null;
      await this.placeTranslationRepo.upsert(
        new PlaceTranslation({
          id: prev?.id,
          placeId: place.id,
          languageCode: lang,
          text: texts[i],
          textSource: lang === source ? TEXT_SOURCE.SOURCE : textSource,
          sourceHash: sourceHash(place.description),
          ttsUrl: tts?.url ?? null,
          ttsPrerendered: tts?.prerendered ?? false,
        })
      );
    }
    return { translated: need.length };
  }
}

/**
 * UC10: a new place or a changed description refreshes that place in every language of the tour,
 * so a language the author turned on does not fall back to "pending" (or keep an old text).
 * Best effort: an AI failure is logged and the place stays stale until the next refresh.
 * @param {{ translations?: EnsureTranslations|null, tourLanguageRepo?, logger? }} deps
 */
export async function refreshPlaceTranslations({ translations, tourLanguageRepo, logger = console }, tour, placeId) {
  if (!translations || !tourLanguageRepo) return;
  const langs = await tourLanguageRepo.listByTour(tour.id);
  for (const l of langs) {
    const voice = l.gender ? { gender: l.gender, region: l.region ?? null } : null;
    try {
      await translations.execute({ tour, lang: l.languageCode, voice, placeIds: [placeId] });
    } catch (err) {
      logger.warn?.(`[tour] refresh translation ${tour.id}/${placeId}/${l.languageCode} failed: ${err.message}`);
    }
  }
}
