// Composition root (task #AI-36): wiring with fakes, no network, no database.
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
