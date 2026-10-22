// =========================================================
// Unit test UC12 — đa ngôn ngữ & TTS với fake repo/dịch vụ (không cần DB).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { SetTourLanguages } from '../src/application/use-cases/set-tour-languages.js';
import { GetLanguageConfig } from '../src/application/use-cases/get-language-config.js';
import { PreviewTts } from '../src/application/use-cases/preview-tts.js';
import { UpdateTranslation } from '../src/application/use-cases/update-translation.js';

const PLACES = [
  { id: 'p1', tourId: 'tour1', name: 'Chùa Cầu', description: 'Cầu cổ ở Hội An' },
  { id: 'p2', tourId: 'tour1', name: 'Nhà cổ', description: 'Nhà cổ Tấn Ký' },
];

function fakeTourRepo(authorId = 'u1', lang = 'vi') {
  const tour = new Tour({ id: 'tour1', title: 'T', originalLanguage: lang, status: TOUR_STATUS.DRAFT, authorId });
  return { async findById(id) { return id === 'tour1' ? tour : null; } };
}
function fakePlaceRepo(places = PLACES) {
  return {
    async listByTour(tourId) { return places.filter((p) => p.tourId === tourId); },
    async findById(id) { return places.find((p) => p.id === id) ?? null; },
  };
}
function fakeLangRepo() {
  const rows = new Map(); // tourId:code -> TourLanguage entity
  return {
    rows,
    async listByTour(tourId) { return [...rows.values()].filter((l) => l.tourId === tourId); },
    async upsertMany(tourId, langs) { for (const l of langs) rows.set(`${tourId}:${l.languageCode}`, l); },
    async deleteLanguages(tourId, codes) { for (const c of codes) rows.delete(`${tourId}:${c}`); },
  };
}
function fakeTxRepo() {
  const rows = new Map(); // placeId:code -> PlaceTranslation entity
  let seq = 0;
  return {
    rows,
    async listByTour() { return [...rows.values()]; },
    async findByPlaceLang(placeId, code) { return rows.get(`${placeId}:${code}`) ?? null; },
    async upsert(tx) { if (!tx.id) tx.id = `tx${++seq}`; rows.set(`${tx.placeId}:${tx.languageCode}`, tx); return tx; },
    async deleteByLanguages(_tourId, codes) {
      for (const [k, v] of rows) if (codes.includes(v.languageCode)) rows.delete(k);
    },
  };
}
const translator = { async translate({ text, to }) { return `[${to}] ${text}`; } };
const tts = { async synthesize({ text, language, voice }) { return { url: `tts://${language}/${voice.gender}/${text.length}`, prerendered: false }; } };
const translatorFail = { async translate() { throw new Error('down'); } };
const ttsFail = { async synthesize() { throw new Error('down'); } };

function deps(over = {}) {
  return {
    tourRepo: fakeTourRepo(),
    placeRepo: fakePlaceRepo(),
    tourLanguageRepo: fakeLangRepo(),
    placeTranslationRepo: fakeTxRepo(),
    translator,
    ttsSynthesizer: tts,
    ...over,
  };
}
const femaleVoice = { gender: 'female', region: 'north' };

test('SetTourLanguages: thêm ngôn ngữ phụ → dịch + TTS cho mọi điểm × ngôn ngữ', async () => {
  const d = deps();
  const cfg = await new SetTourLanguages(d).execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en', 'fr'], voice: femaleVoice });

  assert.equal(cfg.sourceLanguage, 'vi');
  assert.deepEqual(cfg.voice, { gender: 'female', region: 'north' });
  assert.deepEqual(cfg.languages.map((l) => l.languageCode).sort(), ['en', 'fr', 'vi']);
  // 2 điểm × 3 ngôn ngữ = 6 bản ghi; mỗi điểm 3 bản dịch.
  assert.equal(d.placeTranslationRepo.rows.size, 6);
  const p1 = cfg.places.find((p) => p.placeId === 'p1');
  assert.equal(p1.translations.length, 3);
  const en = p1.translations.find((t) => t.languageCode === 'en');
  assert.equal(en.textSource, 'machine');
  assert.equal(en.text, '[en] Cầu cổ ở Hội An');
  assert.ok(en.ttsUrl.startsWith('tts://en/female/'));
  const vi = p1.translations.find((t) => t.languageCode === 'vi');
  assert.equal(vi.textSource, 'source');
  assert.equal(vi.text, 'Cầu cổ ở Hội An'); // text gốc = mô tả điểm
});

test('SetTourLanguages: ngôn ngữ phụ trùng ngôn ngữ gốc bị loại', async () => {
  const cfg = await new SetTourLanguages(deps()).execute({ authorId: 'u1', tourId: 'tour1', secondary: ['vi', 'en'], voice: femaleVoice });
  assert.deepEqual(cfg.languages.map((l) => l.languageCode).sort(), ['en', 'vi']);
});

test('SetTourLanguages: E1 lỗi dịch → 503; lỗi TTS → 503', async () => {
  await assert.rejects(
    () => new SetTourLanguages(deps({ translator: translatorFail })).execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: femaleVoice }),
    (e) => e.status === 503 && e.code === 'translation_unavailable'
  );
  await assert.rejects(
    () => new SetTourLanguages(deps({ ttsSynthesizer: ttsFail })).execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: femaleVoice }),
    (e) => e.status === 503 && e.code === 'tts_unavailable'
  );
});

test('SetTourLanguages: bỏ ngôn ngữ phụ → xóa ngôn ngữ đó và bản dịch của nó', async () => {
  const d = deps();
  const set = new SetTourLanguages(d);
  await set.execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en', 'fr'], voice: femaleVoice });
  const cfg = await set.execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: femaleVoice });

  assert.deepEqual(cfg.languages.map((l) => l.languageCode).sort(), ['en', 'vi']);
  const hasFr = [...d.placeTranslationRepo.rows.values()].some((t) => t.languageCode === 'fr');
  assert.equal(hasFr, false);
  assert.equal(d.placeTranslationRepo.rows.size, 4); // 2 điểm × (vi, en)
});

test('SetTourLanguages: GIỮ bản dịch đã chỉnh tay khi lưu lại', async () => {
  const d = deps();
  await new SetTourLanguages(d).execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: femaleVoice });
  // Chỉnh tay bản dịch tiếng Anh của p1.
  await new UpdateTranslation(d).execute({ authorId: 'u1', tourId: 'tour1', placeId: 'p1', lang: 'en', text: 'Japanese Covered Bridge' });
  // Lưu lại cấu hình — không được ghi đè bản đã sửa.
  const cfg = await new SetTourLanguages(d).execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: femaleVoice });

  const p1en = cfg.places.find((p) => p.placeId === 'p1').translations.find((t) => t.languageCode === 'en');
  assert.equal(p1en.textSource, 'edited');
  assert.equal(p1en.text, 'Japanese Covered Bridge');
});

test('SetTourLanguages: không phải tác giả → 403; tour không tồn tại → 404', async () => {
  await assert.rejects(() => new SetTourLanguages(deps()).execute({ authorId: 'uX', tourId: 'tour1', secondary: [], voice: femaleVoice }), (e) => e.status === 403);
  await assert.rejects(() => new SetTourLanguages(deps()).execute({ authorId: 'u1', tourId: 'ghost', secondary: [], voice: femaleVoice }), (e) => e.status === 404);
});

test('PreviewTts (A1): ngôn ngữ đã cấu hình → trả URL; chưa cấu hình → lỗi', async () => {
  const d = deps();
  await new SetTourLanguages(d).execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: femaleVoice });
  const prev = new PreviewTts(d);
  const r = await prev.execute({ authorId: 'u1', tourId: 'tour1', placeId: 'p1', lang: 'en' });
  assert.ok(r.url.startsWith('tts://en/'));
  await assert.rejects(() => prev.execute({ authorId: 'u1', tourId: 'tour1', placeId: 'p1', lang: 'fr' }), /chưa được cấu hình/);
});

test('UpdateTranslation (A2): sửa ngôn ngữ gốc bị chặn; ngôn ngữ chưa cấu hình bị chặn', async () => {
  const d = deps();
  await new SetTourLanguages(d).execute({ authorId: 'u1', tourId: 'tour1', secondary: ['en'], voice: femaleVoice });
  const upd = new UpdateTranslation(d);
  await assert.rejects(() => upd.execute({ authorId: 'u1', tourId: 'tour1', placeId: 'p1', lang: 'vi', text: 'x' }), /ngôn ngữ gốc/);
  await assert.rejects(() => upd.execute({ authorId: 'u1', tourId: 'tour1', placeId: 'p1', lang: 'fr', text: 'x' }), /chưa được cấu hình/);
});

test('GetLanguageConfig: chưa cấu hình → chỉ ngôn ngữ gốc, chưa có bản dịch', async () => {
  const cfg = await new GetLanguageConfig(deps()).execute({ authorId: 'u1', tourId: 'tour1' });
  assert.deepEqual(cfg.languages, [{ languageCode: 'vi', isSource: true, voice: null }]);
  assert.equal(cfg.voice, null);
  assert.deepEqual(cfg.places.find((p) => p.placeId === 'p1').translations, []);
});
