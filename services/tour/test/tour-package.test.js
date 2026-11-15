// =========================================================
// UC03 (#103) — offline package manifest: GetTourPackage (fake repos) + HTTP route.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { GetTourPackage, buildPackageAssets, isDownloadableUrl } from '../src/application/use-cases/get-tour-package.js';
import { GetPublicTour } from '../src/application/use-cases/get-public-tour.js';
import { SearchTours } from '../src/application/use-cases/search-tours.js';
import { PublicTourController } from '../src/interfaces/http/controllers/public-tour-controller.js';
import { buildPublicTourRouter } from '../src/interfaces/http/routes/public-tour-routes.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';
const RESTRICTED = '33333333-3333-4333-8333-333333333333';
const MEDIA = 'http://localhost:8080/api/media/files';

const tours = [
  {
    id: T1, title: 'Phố cổ', description: 'd', coverImageUrl: `${MEDIA}/cover.jpg`, city: 'Hội An',
    type: 'walking', originalLanguage: 'vi', status: 'public', duration: 60, averageRating: 0,
    ratingCount: 0, authorId: 'a1', updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  },
  { id: DRAFT, title: 'Nháp', originalLanguage: 'vi', status: 'draft', authorId: 'a1' },
  { id: RESTRICTED, title: 'Hạn chế', originalLanguage: 'vi', status: 'restricted', authorId: 'a1' },
];
const places = {
  [T1]: [
    {
      id: 'p1', tourId: T1, name: 'Chùa Cầu', description: 'Cầu cổ', lat: 15.8, lng: 108.3, sequence: 0,
      images: [{ url: `${MEDIA}/a.jpg` }, { url: `${MEDIA}/cover.jpg` }],
      audioSource: 'human', audioUrl: `${MEDIA}/p1-vi.mp3`, updatedAt: new Date('2026-11-03T00:00:00.000Z'),
    },
    {
      id: 'p2', tourId: T1, name: 'Nhà cổ', description: 'Nhà gỗ', lat: 15.81, lng: 108.3, sequence: 1,
      images: [{ url: `${MEDIA}/a.jpg` }, { url: 'data:image/png;base64,xx' }],
      audioSource: 'tts', audioUrl: null, updatedAt: new Date('2026-11-02T00:00:00.000Z'),
    },
  ],
};
const routes = {
  [T1]: {
    tourId: T1, path: [], updatedAt: new Date('2026-10-30T00:00:00.000Z'),
    triggers: [{ placeId: 'p1', zone: { shape: 'circle', center: { lat: 15.8, lng: 108.3 }, radiusMeters: 30 }, priority: 0, nextHint: { text: 'Đi tiếp', audioUrl: `${MEDIA}/hint.mp3` } }],
    navAudios: [{ id: 'n1', label: 'Rẽ trái', audioUrl: `${MEDIA}/nav.mp3`, zone: {} }, { id: 'n2', label: 'TTS', audioUrl: 'tts://vi/x.mp3', zone: {} }],
  },
};
const langs = { [T1]: [{ languageCode: 'vi' }, { languageCode: 'en' }, { languageCode: 'fr' }] };
const translations = {
  [T1]: [
    { placeId: 'p1', languageCode: 'en', text: 'Old bridge', textSource: 'edited', ttsUrl: 'tts://en/p1.mp3', updatedAt: new Date('2026-11-05T00:00:00.000Z') },
    { placeId: 'p2', languageCode: 'en', text: 'Wooden house', textSource: 'edited', ttsUrl: `${MEDIA}/p2-en.mp3`, updatedAt: new Date('2026-11-04T00:00:00.000Z') },
    // fr is configured but not translated for every stop -> not downloadable
    { placeId: 'p1', languageCode: 'fr', text: 'Vieux pont', textSource: 'edited', ttsUrl: null, updatedAt: new Date('2026-11-06T00:00:00.000Z') },
  ],
};

const deps = () => ({
  tourRepo: { async findPublicById(id) { return tours.find((t) => t.id === id && t.status === 'public') ?? null; } },
  placeRepo: { async listByTour(id) { return places[id] ?? []; } },
  routeConfigRepo: { async findByTour(id) { return routes[id] ?? null; } },
  tourLanguageRepo: { async listByTour(id) { return langs[id] ?? []; } },
  placeTranslationRepo: { async listByTour(id) { return translations[id] ?? []; } },
});

test('isDownloadableUrl: http(s) and same-origin paths only', () => {
  assert.equal(isDownloadableUrl('https://x.test/a.mp3'), true);
  assert.equal(isDownloadableUrl('/api/media/files/a.mp3'), true);
  assert.equal(isDownloadableUrl('tts://vi/a.mp3'), false);
  assert.equal(isDownloadableUrl('//evil.test/a'), false);
  assert.equal(isDownloadableUrl('data:image/png;base64,xx'), false);
  assert.equal(isDownloadableUrl(null), false);
});

test('package (source language): detail, human audio, images deduplicated, route audio, revision', async () => {
  const pkg = await new GetTourPackage(deps()).execute({ id: T1 });
  assert.equal(pkg.tourId, T1);
  assert.equal(pkg.language, 'vi');
  // newest of tour (11-01), places (11-03), route (10-30); en/fr translations are ignored for vi
  assert.equal(pkg.revision, '2026-11-03T00:00:00.000Z');
  assert.equal(pkg.detail.selectedLanguage, 'vi');
  assert.deepEqual(pkg.detail.availableLanguages, ['vi', 'en']);
  assert.deepEqual(
    pkg.assets.map((a) => [a.url.replace(MEDIA, ''), a.kind, a.placeId ?? null]),
    [
      ['/cover.jpg', 'image', null],
      ['/a.jpg', 'image', 'p1'],
      ['/p1-vi.mp3', 'audio', 'p1'],
      ['/nav.mp3', 'audio', null],
      ['/hint.mp3', 'audio', 'p1'],
    ],
  );
  const [p1, p2] = pkg.detail.places;
  assert.equal(p1.audioUrl, `${MEDIA}/p1-vi.mp3`);
  assert.equal(p2.audioUrl, null); // device voice reads the text offline
  assert.equal(pkg.detail.route.navAudios[1].audioUrl, null); // tts:// placeholder is not a file
  assert.equal(pkg.detail.route.triggers[0].nextHint.audioUrl, `${MEDIA}/hint.mp3`);
});

test('package (translated language): text of that language, only real audio files', async () => {
  const pkg = await new GetTourPackage(deps()).execute({ id: T1, lang: 'en' });
  assert.equal(pkg.language, 'en');
  assert.equal(pkg.revision, '2026-11-05T00:00:00.000Z'); // en translation is the newest change
  const [p1, p2] = pkg.detail.places;
  assert.equal(p1.text, 'Old bridge');
  assert.equal(p1.audioUrl, null); // tts:// placeholder
  assert.equal(p2.audioUrl, `${MEDIA}/p2-en.mp3`); // a real pre-rendered file is kept
  const audio = pkg.assets.filter((a) => a.kind === 'audio').map((a) => a.url.replace(MEDIA, ''));
  assert.deepEqual(audio, ['/p2-en.mp3', '/nav.mp3', '/hint.mp3']);
  assert.ok(!audio.includes('/p1-vi.mp3')); // the Vietnamese recording is not part of the en package
});

test('package: language not ready -> 400, tour not public -> 404', async () => {
  const uc = new GetTourPackage(deps());
  await assert.rejects(() => uc.execute({ id: T1, lang: 'fr' }), (e) => e.status === 400 && e.code === 'language_not_available');
  await assert.rejects(() => uc.execute({ id: T1, lang: 'de' }), (e) => e.status === 400);
  for (const id of [DRAFT, RESTRICTED, 'ghost']) {
    await assert.rejects(() => uc.execute({ id }), (e) => e.status === 404 && e.code === 'tour_not_found');
  }
});

test('buildPackageAssets: no files -> empty asset list, revision-free pure view', () => {
  const { detail, assets } = buildPackageAssets({ coverImageUrl: null, places: [{ id: 'x', images: [], audioUrl: 'tts://vi/x' }], route: null });
  assert.deepEqual(assets, []);
  assert.equal(detail.places[0].audioUrl, null);
  assert.deepEqual(detail.route.navAudios, []);
});

test('HTTP GET /:id/package — 200, 400 bad language, 404 not public, 400 bad id', async () => {
  const d = deps();
  const controller = new PublicTourController({
    searchTours: new SearchTours({ tourRepo: d.tourRepo, placeRepo: d.placeRepo }),
    getPublicTour: new GetPublicTour(d),
    getTourPackage: new GetTourPackage(d),
  });
  const app = express();
  app.use('/', buildPublicTourRouter({ publicTourController: controller }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/${T1}/package?lang=EN`);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.language, 'en');
    assert.equal(body.detail.id, T1);
    assert.ok(Array.isArray(body.assets) && body.assets.length > 0);
    assert.equal(typeof body.revision, 'string');

    const fr = await fetch(`${base}/${T1}/package?lang=fr`);
    assert.equal(fr.status, 400);
    assert.equal((await fr.json()).code, 'language_not_available');
    assert.equal((await fetch(`${base}/${DRAFT}/package`)).status, 404);
    assert.equal((await fetch(`${base}/${RESTRICTED}/package`)).status, 404);
    // not a UUID -> falls through the public router (contributor routes never match "package")
    assert.equal((await fetch(`${base}/not-a-uuid/package`)).status, 404);
    // the detail route still answers
    assert.equal((await fetch(`${base}/${T1}`)).status, 200);
  } finally {
    server.close();
  }
});
