// Composition root (tasks #AI-36, #AI-37): wiring with fakes, no network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../src/container.js';
import { loadConfig } from '../src/config.js';
import { FakeClock, FakeLogger, validateEvent } from './helpers/fakes.js';

test('builds the place flow and maps the AI config', async () => {
  const config = loadConfig({ INTERNAL_SERVICE_TOKEN: 'tkn', AI_SERVICE_URL: 'http://127.0.0.1:1/', AI_TIMEOUT_MS: '10' });
  const c = buildContainer({ prisma: {}, publish: async () => {}, validateEvent, config, fetchImpl: async () => { throw new Error('no network'); }, clock: new FakeClock(), logger: new FakeLogger() });
  assert.equal(typeof c.handlers.placeSubmitted, 'function');
  assert.equal(typeof c.runPlaceReview.execute, 'function');
  assert.equal(c.aiReviewer.baseUrl, 'http://127.0.0.1:1');
  assert.equal(c.aiReviewer.timeoutMs, 10);
  assert.equal(c.aiReviewer.token, 'tkn');
  assert.ok(!JSON.stringify(c.aiReviewer).includes('tkn'), 'token is not enumerable');
});

test('wires the retry sweeper use-case from config.sweep (#AI-38)', () => {
  const build = (env) => buildContainer({ prisma: {}, publish: async () => {}, validateEvent, config: loadConfig(env), clock: new FakeClock(), logger: new FakeLogger() });
  const c = build({ RETRY_FAILED_AFTER_MS: '1000', RETRY_STALE_AFTER_MS: '2000', RETRY_SWEEP_BATCH_SIZE: '7' });
  assert.equal(typeof c.retryFailedCases.execute, 'function');
  assert.equal(c.retryFailedCases.runPlaceReview, c.runPlaceReview);
  assert.equal(c.retryFailedCases.repo, c.repo);
  assert.equal(c.retryFailedCases.failedAfterMs, 1000);
  assert.equal(c.retryFailedCases.staleAfterMs, 2000);
  assert.equal(c.retryFailedCases.batchSize, 7);

  const d = build({ RETRY_FAILED_AFTER_MS: '1000' });
  assert.equal(d.retryFailedCases.staleAfterMs, 1000, 'stale cutoff defaults to the failed cutoff');
  assert.equal(d.retryFailedCases.batchSize, 10);
});

test('wires the tour flow: handler, use-case with config.geo, sweeper (#AI-37)', () => {
  const config = loadConfig({ GEO_LEG_MAX_M_WALKING: '1234' });
  const c = buildContainer({ prisma: {}, publish: async () => {}, validateEvent, config, clock: new FakeClock(), logger: new FakeLogger() });
  assert.equal(typeof c.handlers.tourSubmitted, 'function');
  assert.equal(typeof c.runTourReview.execute, 'function');
  assert.equal(c.runTourReview.geoLimits, config.geo);
  assert.equal(c.runTourReview.geoLimits.legMaxM.walking, 1234);
  assert.equal(c.runTourReview.aiReviewer, c.aiReviewer);
  assert.equal(c.runTourReview.repo, c.repo);
  assert.equal(c.retryFailedCases.runTourReview, c.runTourReview);
});
