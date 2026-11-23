// =========================================================
// The contributor / itinerary routers take their JWT guard from the container instead of importing
// ../shared, so they load in the CI repo layout and refuse a request the injected guard refuses.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildTourRouter } from '../src/interfaces/http/routes/tour-routes.js';
import { buildPlaceRouter } from '../src/interfaces/http/routes/place-routes.js';
import { buildRouteConfigRouter } from '../src/interfaces/http/routes/route-config-routes.js';
import { buildLanguageRouter } from '../src/interfaces/http/routes/language-routes.js';
import { buildPreviewRouter } from '../src/interfaces/http/routes/preview-routes.js';
import { buildItineraryRouter } from '../src/interfaces/http/routes/itinerary-routes.js';

// Any controller method answers 200: only the guard decides here.
const controller = new Proxy({}, { get: () => (req, res) => res.json({ ok: true }) });
const deny = (req, res) => res.status(401).json({ error: 'no token' });
const allow = (req, res, next) => next();

const TOUR = '11111111-1111-4111-8111-111111111111';
const cases = [
  ['tour', (g) => buildTourRouter({ tourController: controller, requireContributor: g }), '/mine'],
  ['place', (g) => buildPlaceRouter({ placeController: controller, requireContributor: g }), `/mine/${TOUR}/places`],
  ['route-config', (g) => buildRouteConfigRouter({ routeConfigController: controller, requireContributor: g }), `/mine/${TOUR}/route-config`],
  ['language', (g) => buildLanguageRouter({ languageController: controller, requireContributor: g }), `/mine/${TOUR}/languages`],
  ['preview', (g) => buildPreviewRouter({ previewController: controller, requireContributor: g }), `/mine/${TOUR}/preview`],
  ['itinerary', (g) => buildItineraryRouter({ itineraryController: controller, requireAuth: g }), '/'],
];

async function statusOf(router, path) {
  const app = express().use(router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    return (await fetch(`http://127.0.0.1:${server.address().port}${path}`)).status;
  } finally {
    server.close();
  }
}

for (const [name, build, path] of cases) {
  test(`${name} router uses the injected guard`, async () => {
    assert.equal(await statusOf(build(deny), path), 401);
    assert.equal(await statusOf(build(allow), path), 200);
  });
}
