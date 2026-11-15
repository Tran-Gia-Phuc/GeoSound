// =========================================================
// Unit test: translations follow the place description (UC10 + UC12).
//   - source_hash: a machine translation made from an older description is stale
//   - EnsureTranslations: only missing / stale places go to the translator, in one call
//   - AddPlace / UpdatePlace refresh the tour's languages; edited translations are kept (outdated)
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { TourLanguage } from '../src/domain/entities/tour-language.js';
import { PlaceTranslation } from '../src/domain/entities/place-translation.js';
import { sourceHash } from '../src/domain/i18n/source-hash.js';
import {
  isRealTranslation,
  isOutdatedEdit,
  needsTranslation,
  splitLanguagesByReadiness,
} from '../src/domain/i18n/translation-status.js';
import { EnsureTranslations } from '../src/application/use-cases/ensure-translations.js';
import { SetTourLanguages } from '../src/application/use-cases/set-tour-languages.js';
import { UpdateTranslation } from '../src/application/use-cases/update-translation.js';
import { GetLanguageConfig } from '../src/application/use-cases/get-language-config.js';
import { AddPlace } from '../src/application/use-cases/add-place.js';
import { UpdatePlace } from '../src/application/use-cases/update-place.js';

// ---------- domain ----------

test('sourceHash: same text with other whitespace -> same hash; other text -> other hash', () => {
  assert.equal(sourceHash('Cầu  cổ\n ở Hội An'), sourceHash('Cầu cổ ở Hội An'));
  assert.notEqual(sourceHash('Cầu cổ'), sourceHash('Cầu mới'));
  assert.match(sourceHash(''), /^[0-9a-f]{16}$/);
});

test('isRealTranslation / needsTranslation follow the source hash', () => {
  const place = { id: 'p1', description: 'Mô tả mới' };
  const fresh = { text: 'New text', textSource: 'machine', sourceHash: sourceHash('Mô tả mới') };
  const stale = { text: 'Old text', textSource: 'machine', sourceHash: sourceHash('Mô tả cũ') };
  const legacy = { text: 'Old text', textSource: 'machine', sourceHash: null };
  const editedStale = { text: 'Hand text', textSource: 'edited', sourceHash: sourceHash('Mô tả cũ') };
  const echo = { text: 'Mô tả mới', textSource: 'machine', sourceHash: sourceHash('Mô tả mới') };

  assert.equal(isRealTranslation(place, fresh), true);
  assert.equal(isRealTranslation(place, stale), false); // stale -> the language is not ready
  assert.equal(isRealTranslation(place, legacy), true); // row older than the column: served as is
  assert.equal(isRealTranslation(place, editedStale), true); // kept...
  assert.equal(isOutdatedEdit(place, editedStale), true); // ...but flagged for the author
  assert.equal(isOutdatedEdit(place, fresh), false);

  assert.equal(needsTranslation(place, null), true);
  assert.equal(needsTranslation(place, fresh), false);
  assert.equal(needsTranslation(place, stale), true);
  assert.equal(needsTranslation(place, legacy), true); // refresh backfills the hash
  assert.equal(needsTranslation(place, editedStale), false); // never replaced
  assert.equal(needsTranslation(place, echo), true); // a copy of the source is not a translation
});

test('splitLanguagesByReadiness: a stale place makes the language pending and counts outdated edits', () => {
  const places = [{ id: 'p1', description: 'A2' }, { id: 'p2', description: 'B' }];
  const translations = [
    { placeId: 'p1', languageCode: 'en', text: 'A-en', textSource: 'machine', sourceHash: sourceHash('A') },
    { placeId: 'p2', languageCode: 'en', text: 'B-en', textSource: 'machine', sourceHash: sourceHash('B') },
    { placeId: 'p1', languageCode: 'fr', text: 'A-fr', textSource: 'edited', sourceHash: sourceHash('A') },
    { placeId: 'p2', languageCode: 'fr', text: 'B-fr', textSource: 'machine', sourceHash: sourceHash('B') },
  ];
  const r = splitLanguagesByReadiness({ source: 'vi', languages: ['vi', 'en', 'fr'], places, translations });
  assert.deepEqual(r.ready, ['vi', 'fr']);
  assert.deepEqual(r.pending, ['en']);
  assert.deepEqual(r.progress.en, { translated: 1, total: 2, outdated: 0 });
  assert.deepEqual(r.progress.fr, { translated: 2, total: 2, outdated: 1 });
});

// ---------- fakes ----------

function world({ places, langs = ['vi', 'en'], prior = [] } = {}) {
  const tour = new Tour({ id: 'tour1', title: 'Phố cổ', city: 'Hội An', originalLanguage: 'vi', status: TOUR_STATUS.DRAFT, authorId: 'u1' });
  const placeRows = new Map(places.map((p) => [p.id, p]));
  const txRows = new Map(prior.map((t) => [`${t.placeId}:${t.languageCode}`, t]));
  const langRows = langs.map((code) => new TourLanguage({ tourId: 'tour1', languageCode: code, isSource: code === 'vi', gender: 'female' }));
  const calls = [];
  let seq = 0;
  return {
    calls,
    txRows,
    tourRepo: { async findById(id) { return id === 'tour1' ? tour : null; } },
    placeRepo: {
      async listByTour() { return [...placeRows.values()]; },
      async findById(id) { return placeRows.get(id) ?? null; },
      async save(p) { placeRows.set(p.id, p); return p; },
      async create(p) { p.id = `new${++seq}`; placeRows.set(p.id, p); return p; },
      async nextSequence() { return placeRows.size; },
    },
    tourLanguageRepo: {
      async listByTour() { return langRows; },
      async upsertMany() {},
      async deleteLanguages() {},
    },
    placeTranslationRepo: {
      async listByTour() { return [...txRows.values()]; },
      async findByPlaceLang(placeId, code) { return txRows.get(`${placeId}:${code}`) ?? null; },
      async upsert(tx) { txRows.set(`${tx.placeId}:${tx.languageCode}`, tx); return tx; },
      async deleteByLanguages() {},
    },
    translator: {
      async translateMany({ texts, to }) { calls.push({ to, texts }); return texts.map((t) => `${to}:${t}`); },
    },
    ttsSynthesizer: { async synthesize({ language }) { return { url: `tts://${language}`, prerendered: false }; } },
    zoneChecker: { async assertAllowed() {} },
  };
}
const ensureOf = (w) => new EnsureTranslations(w);
const tx = (placeId, code, text, from, textSource = 'machine') =>
  new PlaceTranslation({ placeId, languageCode: code, text, textSource, sourceHash: from == null ? null : sourceHash(from) });

// ---------- EnsureTranslations ----------

test('EnsureTranslations: only missing and stale places are translated, in one call; edited is kept', async () => {
  const places = [
    { id: 'p1', tourId: 'tour1', description: 'Một' }, // fresh
    { id: 'p2', tourId: 'tour1', description: 'Hai mới' }, // stale (made from 'Hai')
    { id: 'p3', tourId: 'tour1', description: 'Ba' }, // missing
    { id: 'p4', tourId: 'tour1', description: 'Bốn mới' }, // edited, stale -> kept
  ];
  const prior = [tx('p1', 'en', 'en:Một', 'Một'), tx('p2', 'en', 'en:Hai', 'Hai'), tx('p4', 'en', 'Four (hand)', 'Bốn', 'edited')];
  const w = world({ places, prior });
  const tour = await w.tourRepo.findById('tour1');

  const r = await ensureOf(w).execute({ tour, lang: 'en' });

  assert.equal(r.translated, 2);
  assert.deepEqual(w.calls, [{ to: 'en', texts: ['Hai mới', 'Ba'] }]);
  assert.equal(w.txRows.get('p2:en').text, 'en:Hai mới');
  assert.equal(w.txRows.get('p2:en').sourceHash, sourceHash('Hai mới'));
  assert.equal(w.txRows.get('p3:en').textSource, 'machine');
  assert.equal(w.txRows.get('p3:en').ttsUrl, 'tts://en');
  assert.equal(w.txRows.get('p4:en').text, 'Four (hand)');
});

test('EnsureTranslations: nothing to do -> no translator call; source language is never translated', async () => {
  const places = [{ id: 'p1', tourId: 'tour1', description: 'Một' }];
  const w = world({ places, prior: [tx('p1', 'en', 'en:Một', 'Một')] });
  const tour = await w.tourRepo.findById('tour1');
  assert.equal((await ensureOf(w).execute({ tour, lang: 'en' })).translated, 0);
  await ensureOf(w).execute({ tour, lang: 'vi' });
  assert.equal(w.calls.length, 0);
  assert.equal(w.txRows.get('p1:vi').text, 'Một');
  assert.equal(w.txRows.get('p1:vi').textSource, 'source');
});

test('EnsureTranslations: translator down -> 503 translation_unavailable', async () => {
  const w = world({ places: [{ id: 'p1', tourId: 'tour1', description: 'Một' }] });
  w.translator = { async translateMany() { throw new Error('down'); } };
  const tour = await w.tourRepo.findById('tour1');
  await assert.rejects(() => ensureOf(w).execute({ tour, lang: 'en' }), (e) => e.status === 503 && e.code === 'translation_unavailable');
});

// ---------- SetTourLanguages: saving again does not re-translate fresh rows ----------

test('SetTourLanguages: a fresh machine translation is not sent again on save', async () => {
  const places = [{ id: 'p1', tourId: 'tour1', description: 'Một' }, { id: 'p2', tourId: 'tour1', description: 'Hai' }];
  const w = world({ places, prior: [tx('p1', 'en', 'en:Một', 'Một')] });
  await new SetTourLanguages(w).execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: { gender: 'male' } });
  assert.deepEqual(w.calls, [{ to: 'en', texts: ['Hai'] }]);
  assert.equal(w.txRows.get('p1:en').ttsUrl, 'tts://en'); // TTS rendered again with the chosen voice
});

// ---------- UC10: AddPlace / UpdatePlace refresh translations ----------

test('UpdatePlace: new description -> the place is translated again in every language of the tour', async () => {
  const places = [{ id: 'p1', tourId: 'tour1', description: 'Một' }];
  const w = world({ places, langs: ['vi', 'en', 'fr'], prior: [tx('p1', 'en', 'en:Một', 'Một'), tx('p1', 'fr', 'fr:Một', 'Một')] });
  const { Place } = await import('../src/domain/entities/place.js');
  await w.placeRepo.save(new Place({ id: 'p1', tourId: 'tour1', name: 'A', description: 'Một', lat: 15, lng: 108, sequence: 0 }));

  await new UpdatePlace({ ...w, translations: ensureOf(w) }).execute({
    authorId: 'u1', tourId: 'tour1', placeId: 'p1', patch: { description: 'Một mới' },
  });

  assert.deepEqual(w.calls.map((c) => c.to), ['en', 'fr']);
  assert.equal(w.txRows.get('p1:en').text, 'en:Một mới');
  assert.equal(w.txRows.get('p1:vi').text, 'Một mới');
});

test('UpdatePlace: name only -> no translation; AI down -> the edit is still saved', async () => {
  const { Place } = await import('../src/domain/entities/place.js');
  const w = world({ places: [], prior: [] });
  await w.placeRepo.save(new Place({ id: 'p1', tourId: 'tour1', name: 'A', description: 'Một', lat: 15, lng: 108, sequence: 0 }));
  const update = new UpdatePlace({ ...w, translations: ensureOf(w), logger: { warn() {} } });

  await update.execute({ authorId: 'u1', tourId: 'tour1', placeId: 'p1', patch: { name: 'B' } });
  assert.equal(w.calls.length, 0);

  w.translator.translateMany = async () => { throw new Error('down'); };
  const saved = await update.execute({ authorId: 'u1', tourId: 'tour1', placeId: 'p1', patch: { description: 'Hai' } });
  assert.equal(saved.description, 'Hai');
  assert.equal(w.txRows.get('p1:en'), undefined); // stays missing -> en is pending until the next refresh
});

test('AddPlace: the new place is translated into the languages the author turned on', async () => {
  const w = world({ places: [], langs: ['vi', 'en'] });
  const created = await new AddPlace({ ...w, translations: ensureOf(w) }).execute({
    authorId: 'u1', tourId: 'tour1', name: 'Chùa Cầu', description: 'Cầu cổ', lat: 15.8, lng: 108.3,
  });
  assert.deepEqual(w.calls, [{ to: 'en', texts: ['Cầu cổ'] }]);
  assert.equal(w.txRows.get(`${created.id}:en`).text, 'en:Cầu cổ');
});

// ---------- Studio: an edited translation whose source changed is flagged ----------

test('GetLanguageConfig: edited translation made from an older description -> outdated', async () => {
  const places = [{ id: 'p1', tourId: 'tour1', name: 'A', description: 'Một' }];
  const w = world({ places, prior: [tx('p1', 'en', 'en:Một', 'Một')] });
  await new UpdateTranslation(w).execute({ authorId: 'u1', tourId: 'tour1', placeId: 'p1', lang: 'en', text: 'One (hand)' });
  let cfg = await new GetLanguageConfig(w).execute({ authorId: 'u1', tourId: 'tour1' });
  assert.equal(cfg.places[0].translations.find((t) => t.languageCode === 'en').outdated, false);

  places[0].description = 'Một mới';
  cfg = await new GetLanguageConfig(w).execute({ authorId: 'u1', tourId: 'tour1' });
  assert.equal(cfg.places[0].translations.find((t) => t.languageCode === 'en').outdated, true);
  const en = cfg.languages.find((l) => l.languageCode === 'en');
  assert.equal(en.ready, true);
  assert.equal(en.outdated, 1);
});
