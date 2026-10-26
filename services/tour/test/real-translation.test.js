// =========================================================
// Unit test dịch thật (UC12): adapter AI service, dịch theo lô, giữ bản dịch còn
// đúng, và khách chỉ thấy ngôn ngữ đã dịch thật (UC02/UC04).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AiTranslator } from '../src/infrastructure/i18n/ai-translator.js';
import { EchoTranslator } from '../src/infrastructure/i18n/echo-translator.js';
import { isRealTranslation, splitLanguagesByReadiness } from '../src/domain/i18n/translation-status.js';
import { SetTourLanguages } from '../src/application/use-cases/set-tour-languages.js';
import { buildTourDetailView } from '../src/application/use-cases/build-tour-detail.js';
import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { PlaceTranslation } from '../src/domain/entities/place-translation.js';

// ---------- AiTranslator ----------

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    return handler(body, calls.length);
  };
  fn.calls = calls;
  return fn;
}
const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

test('AiTranslator: chia lô theo batchSize, ghép kết quả đúng thứ tự', async () => {
  const fetchImpl = fakeFetch((body) => okJson({ translations: body.texts.map((t) => `EN:${t}`) }));
  const tr = new AiTranslator({ baseUrl: 'http://ai:3004/', batchSize: 2, fetchImpl });
  const out = await tr.translateMany({ texts: ['a', 'b', 'c'], from: 'vi', to: 'en', context: 'Hội An' });
  assert.deepEqual(out, ['EN:a', 'EN:b', 'EN:c']);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[0].url, 'http://ai:3004/translate');
  assert.deepEqual(fetchImpl.calls[0].body, { source_lang: 'vi', target_lang: 'en', texts: ['a', 'b'], context: 'Hội An' });
});

test('AiTranslator: HTTP lỗi hoặc sai số lượng → ném lỗi', async () => {
  const down = new AiTranslator({ baseUrl: 'http://ai', fetchImpl: fakeFetch(() => ({ ok: false, status: 503 })) });
  await assert.rejects(() => down.translate({ text: 'x', from: 'vi', to: 'en' }), /503/);
  const short = new AiTranslator({ baseUrl: 'http://ai', fetchImpl: fakeFetch(() => okJson({ translations: [] })) });
  await assert.rejects(() => short.translate({ text: 'x', from: 'vi', to: 'en' }), /số lượng/);
});

// ---------- translation-status ----------

const place = (id, description) => ({ id, description });

test('isRealTranslation: rỗng / y nguyên gốc → không; khác gốc hoặc đã chỉnh tay → có', () => {
  const p = place('p1', 'Chùa Cầu  cổ');
  assert.equal(isRealTranslation(p, null), false);
  assert.equal(isRealTranslation(p, { text: '  ', textSource: 'machine' }), false);
  assert.equal(isRealTranslation(p, { text: 'Chùa Cầu cổ', textSource: 'machine' }), false);
  assert.equal(isRealTranslation(p, { text: 'Chùa Cầu cổ', textSource: 'edited' }), true);
  assert.equal(isRealTranslation(p, { text: 'Japanese Bridge', textSource: 'machine' }), true);
});

test('splitLanguagesByReadiness: ngôn ngữ thiếu bản dịch thật ở một điểm → pending', () => {
  const places = [place('p1', 'A'), place('p2', 'B')];
  const translations = [
    { placeId: 'p1', languageCode: 'en', text: 'A-en', textSource: 'machine' },
    { placeId: 'p2', languageCode: 'en', text: 'B-en', textSource: 'machine' },
    { placeId: 'p1', languageCode: 'fr', text: 'A-fr', textSource: 'machine' },
    { placeId: 'p2', languageCode: 'fr', text: 'B', textSource: 'machine' }, // echo
  ];
  const r = splitLanguagesByReadiness({ source: 'vi', languages: ['vi', 'en', 'fr'], places, translations });
  assert.deepEqual(r.ready, ['vi', 'en']);
  assert.deepEqual(r.pending, ['fr']);
  assert.deepEqual(r.progress.fr, { translated: 1, total: 2 });
});

// ---------- buildTourDetailView: khách chỉ chọn được ngôn ngữ đã dịch thật ----------

test('buildTourDetailView: Echo (chưa dịch) → ngôn ngữ phụ nằm ở pendingLanguages, không cho chọn', () => {
  const tour = new Tour({ id: 't1', title: 'T', originalLanguage: 'vi', authorId: 'u1', status: TOUR_STATUS.PUBLIC });
  const places = [{ id: 'p1', name: 'A', description: 'Mô tả', lat: 1, lng: 1, sequence: 0, images: [], audioSource: 'tts' }];
  const langs = [{ languageCode: 'vi' }, { languageCode: 'en' }];
  const translations = [{ placeId: 'p1', languageCode: 'en', text: 'Mô tả', textSource: 'machine' }];
  const view = buildTourDetailView({ tour, places, langs, translations, lang: 'en' });
  assert.deepEqual(view.availableLanguages, ['vi']);
  assert.deepEqual(view.pendingLanguages, ['en']);
  assert.equal(view.selectedLanguage, 'vi'); // chọn en bị trả về ngôn ngữ gốc
});

// ---------- SetTourLanguages: dịch theo lô + giữ bản dịch còn đúng ----------

function repos(places, prior = []) {
  const tour = new Tour({ id: 'tour1', title: 'Phố cổ', city: 'Hội An', originalLanguage: 'vi', authorId: 'u1' });
  const rows = new Map(prior.map((t) => [`${t.placeId}:${t.languageCode}`, t]));
  return {
    tourRepo: { async findById() { return tour; } },
    placeRepo: { async listByTour() { return places; } },
    tourLanguageRepo: {
      langs: [],
      async listByTour() { return this.langs; },
      async upsertMany(_t, l) { this.langs = l; },
      async deleteLanguages() {},
    },
    placeTranslationRepo: {
      rows,
      async listByTour() { return [...rows.values()]; },
      async upsert(tx) { rows.set(`${tx.placeId}:${tx.languageCode}`, tx); return tx; },
      async deleteByLanguages() {},
    },
    ttsSynthesizer: { async synthesize({ language }) { return { url: `tts://${language}`, prerendered: false }; } },
  };
}

test('SetTourLanguages: mỗi ngôn ngữ phụ gọi translateMany MỘT lần cho mọi điểm, kèm ngữ cảnh tour', async () => {
  const places = [
    { id: 'p1', name: 'A', description: 'Một', updatedAt: new Date('2026-01-01') },
    { id: 'p2', name: 'B', description: 'Hai', updatedAt: new Date('2026-01-01') },
  ];
  const calls = [];
  const translator = {
    async translate() { throw new Error('không được gọi từng đoạn'); },
    async translateMany({ texts, to, context }) { calls.push({ texts, to, context }); return texts.map((t) => `${to}:${t}`); },
  };
  const d = repos(places);
  await new SetTourLanguages({ ...d, translator }).execute({
    authorId: 'u1', tourId: 'tour1', secondary: ['en', 'fr'], voice: { gender: 'female' },
  });
  assert.deepEqual(calls.map((c) => c.to), ['en', 'fr']);
  assert.deepEqual(calls[0].texts, ['Một', 'Hai']);
  assert.equal(calls[0].context, 'Phố cổ — Hội An');
  assert.equal(d.placeTranslationRepo.rows.get('p2:fr').text, 'fr:Hai');
});

test('SetTourLanguages: bản dịch máy được dịch lại mỗi lần lưu; bản chỉnh tay được giữ', async () => {
  const places = [
    { id: 'p1', name: 'A', description: 'Một' },
    { id: 'p2', name: 'B', description: 'Hai' },
  ];
  const prior = [
    new PlaceTranslation({ id: 'x1', placeId: 'p1', languageCode: 'en', text: '[EN] Một', textSource: 'machine' }),
    new PlaceTranslation({ id: 'x2', placeId: 'p2', languageCode: 'en', text: 'Two (hand)', textSource: 'edited' }),
  ];
  const calls = [];
  const translator = { async translateMany({ texts }) { calls.push(texts); return texts.map(() => 'One'); } };
  const d = repos(places, prior);
  await new SetTourLanguages({ ...d, translator }).execute({
    authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: { gender: 'male' },
  });
  assert.deepEqual(calls, [['Một']]); // chỉ điểm chưa chỉnh tay
  assert.equal(d.placeTranslationRepo.rows.get('p1:en').text, 'One');
  assert.equal(d.placeTranslationRepo.rows.get('p2:en').text, 'Two (hand)');
});

test('SetTourLanguages: adapter chỉ có translate (Echo) vẫn chạy được', async () => {
  const d = repos([{ id: 'p1', name: 'A', description: 'Một' }]);
  await new SetTourLanguages({ ...d, translator: new EchoTranslator() }).execute({
    authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: { gender: 'female' },
  });
  assert.equal(d.placeTranslationRepo.rows.get('p1:en').text, 'Một');
});

test('SetTourLanguages: AI service lỗi → E1 503', async () => {
  const d = repos([{ id: 'p1', name: 'A', description: 'Một' }]);
  const translator = { async translateMany() { throw new Error('down'); } };
  await assert.rejects(
    () => new SetTourLanguages({ ...d, translator }).execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: { gender: 'female' } }),
    (e) => e.status === 503,
  );
});
