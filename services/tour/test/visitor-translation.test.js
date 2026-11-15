// =========================================================
// Unit + HTTP test: a tourist asks for a language that is not available (UC04 / UC12).
//   - buildTourDetailView: automatic languages, language kinds, fallback reason, original text
//   - TranslateTourForVisitor: auto rows once, cache, single flight, 400 / 403 / 404 / 503
//   - SetTourLanguages reuses auto rows; tour.published leaves them out; SetAutoTranslate
//   - rateLimit middleware and POST /:id/translations/:lang
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { TourLanguage } from '../src/domain/entities/tour-language.js';
import { PlaceTranslation } from '../src/domain/entities/place-translation.js';
import { sourceHash } from '../src/domain/i18n/source-hash.js';
import { SUPPORTED_LANGUAGES } from '../src/domain/value-objects/language.js';
import { buildTourDetailView } from '../src/application/use-cases/build-tour-detail.js';
import { EnsureTranslations } from '../src/application/use-cases/ensure-translations.js';
import { TranslateTourForVisitor } from '../src/application/use-cases/translate-for-visitor.js';
import { GetPublicTour } from '../src/application/use-cases/get-public-tour.js';
import { SetTourLanguages } from '../src/application/use-cases/set-tour-languages.js';
import { GetLanguageConfig } from '../src/application/use-cases/get-language-config.js';
import { SetAutoTranslate } from '../src/application/use-cases/set-auto-translate.js';
import { notifyTourPublished } from '../src/application/use-cases/notify-tour-catalog.js';
import { rateLimit, clientIp } from '../src/interfaces/http/middleware/rate-limit.js';
import { PublicTourController } from '../src/interfaces/http/controllers/public-tour-controller.js';
import { buildPublicTourRouter } from '../src/interfaces/http/routes/public-tour-routes.js';

const TOUR_ID = '11111111-1111-4111-8111-111111111111';
const tx = (placeId, code, text, from, textSource = 'machine') =>
  new PlaceTranslation({ placeId, languageCode: code, text, textSource, sourceHash: sourceHash(from) });

// ---------- buildTourDetailView ----------

function viewOf({ autoTranslate = true, langs = ['vi', 'en'], translations = [], lang } = {}) {
  const tour = new Tour({ id: TOUR_ID, title: 'T', originalLanguage: 'vi', authorId: 'u1', status: TOUR_STATUS.PUBLIC, autoTranslate });
  const places = [
    { id: 'p1', name: 'A', description: 'Một', lat: 1, lng: 1, sequence: 0, images: [], audioSource: 'tts' },
    { id: 'p2', name: 'B', description: 'Hai', lat: 1, lng: 1, sequence: 1, images: [], audioSource: 'tts' },
  ];
  return buildTourDetailView({ tour, places, langs: langs.map((languageCode) => ({ languageCode })), translations, lang });
}
const EN = [tx('p1', 'en', 'One', 'Một'), tx('p2', 'en', 'Two', 'Hai')];
const DE = [tx('p1', 'de', 'Eins', 'Một', 'auto'), tx('p2', 'de', 'Zwei', 'Hai', 'auto')];

test('detail: a complete automatic language is available, labelled auto, with the original text', () => {
  const v = viewOf({ translations: [...EN, ...DE], lang: 'de' });
  assert.deepEqual(v.availableLanguages, ['vi', 'en', 'de']);
  assert.deepEqual(v.languageKinds, { vi: 'source', en: 'author', de: 'auto' });
  assert.equal(v.selectedLanguage, 'de');
  assert.equal(v.fallbackReason, null);
  assert.equal(v.places[0].text, 'Eins');
  assert.equal(v.places[0].translationKind, 'auto');
  assert.equal(v.places[0].originalText, 'Một');
  assert.ok(!v.translatableLanguages.includes('de'));
  assert.ok(v.translatableLanguages.includes('fr'));
  assert.equal(v.translatableLanguages.length, SUPPORTED_LANGUAGES.length - 3);
});

test('detail: source and author languages carry no auto label; source has no originalText', () => {
  const vi = viewOf({ translations: EN });
  assert.equal(vi.places[0].translationKind, undefined);
  assert.equal(vi.places[0].originalText, undefined);
  const en = viewOf({ translations: EN, lang: 'en' });
  assert.equal(en.places[0].translationKind, 'author');
});

test('detail: fallback reasons say why the source language is played', () => {
  assert.equal(viewOf({ translations: EN }).fallbackReason, null); // nothing asked
  assert.equal(viewOf({ translations: EN, lang: 'xx' }).fallbackReason, 'not_supported');
  const fr = viewOf({ translations: EN, lang: 'fr' });
  assert.equal(fr.selectedLanguage, 'vi');
  assert.equal(fr.requestedLanguage, 'fr');
  assert.equal(fr.fallbackReason, 'not_translated');
  assert.equal(viewOf({ autoTranslate: false, translations: EN, lang: 'fr' }).fallbackReason, 'auto_disabled');
});

test('detail: auto translation off hides automatic languages; the author pending language stays askable', () => {
  const v = viewOf({ autoTranslate: false, langs: ['vi', 'en', 'fr'], translations: [...EN, ...DE], lang: 'de' });
  assert.deepEqual(v.availableLanguages, ['vi', 'en']);
  assert.deepEqual(v.translatableLanguages, ['fr']);
  assert.equal(v.fallbackReason, 'auto_disabled');
  assert.equal(v.autoTranslate, false);
});

// ---------- TranslateTourForVisitor ----------

function world({ status = TOUR_STATUS.PUBLIC, autoTranslate = true, langs = ['vi', 'en'], prior = [] } = {}) {
  const tour = new Tour({ id: TOUR_ID, title: 'Phố cổ', city: 'Hội An', originalLanguage: 'vi', authorId: 'u1', status, autoTranslate });
  const places = [
    { id: 'p1', tourId: TOUR_ID, name: 'A', description: 'Một', lat: 1, lng: 1, sequence: 0, images: [], audioSource: 'tts' },
    { id: 'p2', tourId: TOUR_ID, name: 'B', description: 'Hai', lat: 1, lng: 1, sequence: 1, images: [], audioSource: 'tts' },
  ];
  const txRows = new Map(prior.map((t) => [`${t.placeId}:${t.languageCode}`, t]));
  let langRows = langs.map((code) => new TourLanguage({ tourId: TOUR_ID, languageCode: code, isSource: code === 'vi', gender: 'male' }));
  const calls = [];
  const d = {
    tour,
    calls,
    txRows,
    tourRepo: {
      async findById(id) { return id === TOUR_ID ? tour : null; },
      async findPublicById(id) { return id === TOUR_ID && tour.status === TOUR_STATUS.PUBLIC ? tour : null; },
      async setAutoTranslate(t, enabled) { t.autoTranslate = enabled; return t; },
    },
    placeRepo: { async listByTour() { return places; }, async findById(id) { return places.find((p) => p.id === id) ?? null; } },
    routeConfigRepo: { async findByTour() { return null; } },
    tourLanguageRepo: {
      async listByTour() { return langRows; },
      async upsertMany(_t, l) { langRows = l; },
      async deleteLanguages() {},
    },
    placeTranslationRepo: {
      async listByTour() { return [...txRows.values()]; },
      async findByPlaceLang(placeId, code) { return txRows.get(`${placeId}:${code}`) ?? null; },
      async upsert(t) { txRows.set(`${t.placeId}:${t.languageCode}`, t); return t; },
      async deleteByLanguages() {},
    },
    translator: {
      async translateMany({ texts, to }) {
        calls.push({ to, texts });
        await new Promise((r) => setTimeout(r, 5));
        return texts.map((t) => `${to}:${t}`);
      },
    },
    ttsSynthesizer: { async synthesize({ language, voice }) { return { url: `tts://${language}/${voice.gender}`, prerendered: false }; } },
  };
  d.translations = new EnsureTranslations(d);
  d.getPublicTour = new GetPublicTour(d);
  d.visitor = new TranslateTourForVisitor(d);
  return d;
}

test('visitor: a new language is translated once as auto, kept, and served on the next call without AI', async () => {
  const w = world({ prior: EN });
  const view = await w.visitor.publicTour({ id: TOUR_ID, lang: 'DE' });
  assert.equal(view.selectedLanguage, 'de');
  assert.equal(view.languageKinds.de, 'auto');
  assert.equal(view.places[1].text, 'de:Hai');
  assert.deepEqual(w.calls, [{ to: 'de', texts: ['Một', 'Hai'] }]);
  assert.equal(w.txRows.get('p1:de').textSource, 'auto');
  assert.equal(w.txRows.get('p1:de').ttsUrl, 'tts://de/male'); // voice of the tour

  const again = await w.visitor.publicTour({ id: TOUR_ID, lang: 'de' });
  assert.equal(again.selectedLanguage, 'de');
  assert.equal(w.calls.length, 1);
});

test('visitor: ten tourists asking at once cost one AI call (single flight)', async () => {
  const w = world({ prior: EN });
  const views = await Promise.all(Array.from({ length: 10 }, () => w.visitor.publicTour({ id: TOUR_ID, lang: 'fr' })));
  assert.equal(w.calls.length, 1);
  assert.ok(views.every((v) => v.selectedLanguage === 'fr'));
});

test('visitor: the author language with a missing place is filled as machine; source needs no AI', async () => {
  const w = world({ prior: [EN[0]] });
  await w.visitor.publicTour({ id: TOUR_ID, lang: 'en' });
  assert.deepEqual(w.calls, [{ to: 'en', texts: ['Hai'] }]);
  assert.equal(w.txRows.get('p2:en').textSource, 'machine');
  const vi = await w.visitor.publicTour({ id: TOUR_ID, lang: 'vi' });
  assert.equal(vi.selectedLanguage, 'vi');
  assert.equal(w.calls.length, 1);
});

test('visitor: 400 unsupported, 403 auto off, 404 not public, 503 AI down', async () => {
  await assert.rejects(() => world().visitor.publicTour({ id: TOUR_ID, lang: 'xx' }), (e) => e.status === 400);
  await assert.rejects(
    () => world({ autoTranslate: false }).visitor.publicTour({ id: TOUR_ID, lang: 'de' }),
    (e) => e.status === 403 && e.code === 'auto_translate_disabled'
  );
  await assert.rejects(() => world({ status: TOUR_STATUS.DRAFT }).visitor.publicTour({ id: TOUR_ID, lang: 'de' }), (e) => e.status === 404);
  const down = world();
  down.translator.translateMany = async () => { throw new Error('down'); };
  await assert.rejects(() => down.visitor.publicTour({ id: TOUR_ID, lang: 'de' }), (e) => e.status === 503 && e.code === 'translation_unavailable');
});

test('visitor: auto off still lets a tourist fill the author language', async () => {
  const w = world({ autoTranslate: false, prior: [EN[0]] });
  const v = await w.visitor.publicTour({ id: TOUR_ID, lang: 'en' });
  assert.equal(v.selectedLanguage, 'en');
});

test('visitor (restricted): access is checked before any AI call', async () => {
  const w = world({ status: TOUR_STATUS.RESTRICTED ?? 'restricted' });
  const denied = { async execute() { const e = new Error('Tour không còn khả dụng'); e.status = 404; throw e; } };
  const visitor = new TranslateTourForVisitor({ ...w, getRestrictedTour: denied });
  await assert.rejects(() => visitor.restrictedTour({ tourId: TOUR_ID, userId: 'x', lang: 'de' }), (e) => e.status === 404);
  assert.equal(w.calls.length, 0);
});

// ---------- author side ----------

test('SetTourLanguages: turning on a language tourists already asked for reuses the auto rows', async () => {
  const w = world({ prior: [...EN, ...DE] });
  const cfg = await new SetTourLanguages(w).execute({ authorId: 'u1', tourId: TOUR_ID, secondary: ['en', 'de'], voice: { gender: 'female' } });
  assert.equal(w.calls.length, 0);
  assert.equal(w.txRows.get('p1:de').textSource, 'machine');
  assert.equal(cfg.languages.find((l) => l.languageCode === 'de').ready, true);
});

test('GetLanguageConfig: lists automatic languages and the auto switch', async () => {
  const w = world({ prior: [...EN, ...DE] });
  const cfg = await new GetLanguageConfig(w).execute({ authorId: 'u1', tourId: TOUR_ID });
  assert.equal(cfg.autoTranslate, true);
  assert.deepEqual(cfg.autoLanguages, [{ languageCode: 'de', ready: true, translated: 2, total: 2 }]);
});

test('SetAutoTranslate: owner only, writes the switch', async () => {
  const w = world();
  const uc = new SetAutoTranslate(w);
  await assert.rejects(() => uc.execute({ authorId: 'other', tourId: TOUR_ID, enabled: false }), (e) => e.status === 403);
  assert.deepEqual(await uc.execute({ authorId: 'u1', tourId: TOUR_ID, enabled: false }), { autoTranslate: false });
  assert.equal(w.tour.autoTranslate, false);
});

test('tour.published leaves automatic translations out (chatbot index)', async () => {
  const w = world({ prior: [...EN, ...DE] });
  let sent;
  const catalog = { async publishTourPublished(_t, _p, i18n) { sent = i18n; } };
  await notifyTourPublished({ ...w, catalog }, w.tour);
  assert.deepEqual([...new Set(sent.translations.map((t) => t.languageCode))], ['en']);
});

// ---------- rate limit + HTTP ----------

test('rateLimit: 429 after max per IP and window, x-forwarded-for first entry is the client', async () => {
  let t = 0;
  const mw = rateLimit({ max: 2, windowMs: 1000, now: () => t });
  const run = (ip) => {
    const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, set(k, v) { this.headers[k] = v; }, json(b) { this.body = b; return this; } };
    let passed = false;
    mw({ headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` }, ip: '10.0.0.1' }, res, () => { passed = true; });
    return passed ? 200 : res.code;
  };
  assert.deepEqual([run('1.1.1.1'), run('1.1.1.1'), run('1.1.1.1'), run('2.2.2.2')], [200, 200, 429, 200]);
  t = 1000;
  assert.equal(run('1.1.1.1'), 200);
  assert.equal(clientIp({ headers: {}, ip: '9.9.9.9' }), '9.9.9.9');
});

test('HTTP: POST /:id/translations/:lang -> 200 detail, 400 bad code, 429 over the limit', async () => {
  const w = world({ prior: EN });
  const controller = new PublicTourController({ getPublicTour: w.getPublicTour, translateTourForVisitor: w.visitor });
  const app = express();
  app.use('/', buildPublicTourRouter({ publicTourController: controller, translateLimiter: rateLimit({ max: 3, windowMs: 60000 }) }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path) => {
    const res = await fetch(base + path, { method: 'POST' });
    return { status: res.status, body: await res.json() };
  };
  try {
    const ok = await post(`/${TOUR_ID}/translations/de`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.tour.selectedLanguage, 'de');
    assert.equal((await post(`/${TOUR_ID}/translations/xx`)).status, 400);
    assert.equal((await post(`/${TOUR_ID}/translations/d`)).status, 400);
    const limited = await post(`/${TOUR_ID}/translations/de`);
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'rate_limited');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
