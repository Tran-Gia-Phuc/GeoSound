// UC12 (#425) — the listening languages come from SUPPORTED_LANGUAGES (Tour owns the list) and the
// client reads them from GET /api/tours/languages (public, no sign-in).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import {
  DEFAULT_LANGUAGES,
  Language,
  parseLanguageList,
  configureSupportedLanguages,
} from '../src/domain/value-objects/language.js';
import * as languageModule from '../src/domain/value-objects/language.js';
import { buildTourDetailView } from '../src/application/use-cases/build-tour-detail.js';
import { PublicTourController } from '../src/interfaces/http/controllers/public-tour-controller.js';
import { buildPublicTourRouter } from '../src/interfaces/http/routes/public-tour-routes.js';

after(() => configureSupportedLanguages([]));

test('parseLanguageList: trims, lower-cases, drops duplicates and reports invalid codes', () => {
  assert.deepEqual(parseLanguageList(' vi, EN ,id,zh-TW,, en ,pt-br'), {
    codes: ['vi', 'en', 'id', 'zh-tw', 'pt-br'],
    invalid: [],
  });
  assert.deepEqual(parseLanguageList('vi,english,x,zh_TW,1a'), {
    codes: ['vi'],
    invalid: ['english', 'x', 'zh_TW', '1a'],
  });
  assert.deepEqual(parseLanguageList(undefined), { codes: [], invalid: [] });
  assert.deepEqual(parseLanguageList(''), { codes: [], invalid: [] });
});

test('configureSupportedLanguages: an empty list keeps the default; the value object follows the list', () => {
  assert.deepEqual(configureSupportedLanguages([]), DEFAULT_LANGUAGES);
  assert.throws(() => new Language('id'), /Ngôn ngữ không hỗ trợ: id/);

  const list = configureSupportedLanguages(['vi', 'en', 'id']);
  assert.deepEqual(list, ['vi', 'en', 'id']);
  assert.ok(Object.isFrozen(list));
  assert.deepEqual(languageModule.SUPPORTED_LANGUAGES, ['vi', 'en', 'id']);
  assert.equal(new Language(' ID ').value, 'id');
  assert.throws(() => new Language('fr'), /Ngôn ngữ không hỗ trợ: fr/);

  configureSupportedLanguages([]);
  assert.equal(new Language('fr').value, 'fr');
});

test('detail view: translatable languages and the not_supported reason use the configured list', () => {
  configureSupportedLanguages(['vi', 'en', 'id']);
  try {
    const tour = { id: 't1', originalLanguage: 'vi', autoTranslate: true };
    const view = buildTourDetailView({ tour, places: [], langs: [{ languageCode: 'en' }], lang: 'fr' });
    assert.deepEqual(view.translatableLanguages, ['id']);
    assert.equal(view.fallbackReason, 'not_supported');
  } finally {
    configureSupportedLanguages([]);
  }
});

test('HTTP: GET /languages returns the list without a sign-in', async () => {
  const controller = new PublicTourController({}, { supportedLanguages: ['vi', 'en', 'id'] });
  const app = express();
  app.use('/', buildPublicTourRouter({ publicTourController: controller }));
  app.use((_req, res) => res.status(401).json({ error: 'sign in' }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/languages`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /max-age=300/);
    assert.deepEqual(await res.json(), { languages: ['vi', 'en', 'id'] });
  } finally {
    await new Promise((r) => server.close(r));
  }
});
