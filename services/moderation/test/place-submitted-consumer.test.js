// place.submitted handler (task #AI-36): validates, delegates, never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceSubmittedHandler } from '../src/interfaces/events/place-submitted-consumer.js';
import { FakeLogger, validateEvent } from './helpers/fakes.js';

const valid = {
  placeId: 'p1', tourId: 't1', contributorId: 'u1', revision: '2026-01-01T00:00:00.000Z',
  name: 'Ben Thanh Market', description: 'A historic market.', language: 'vi', lat: 10.77, lng: 106.69,
};

function setup(execute = async () => {}) {
  const calls = [];
  const logger = new FakeLogger();
  const runPlaceReview = { execute: async (p) => { calls.push(p); return execute(p); } };
  return { calls, logger, handle: createPlaceSubmittedHandler({ runPlaceReview, validate: validateEvent, logger }) };
}

test('invalid payload is logged and dropped without calling the use-case', async () => {
  const { calls, logger, handle } = setup();
  await assert.doesNotReject(handle('place.submitted', { ...valid, lat: 999, revision: '2026-01-01T07:00:00+07:00' }));
  assert.equal(calls.length, 0);
  assert.ok(logger.lines.some(([level, m]) => level === 'warn' && /lat/.test(m) && /revision/.test(m)));
  assert.ok(!logger.lines.some(([, m]) => m.includes('Ben Thanh')), 'content is never logged');
});

test('valid payload runs the use-case with the parsed payload', async () => {
  const { calls, handle } = setup();
  await handle('place.submitted', { ...valid, unknownKey: 'dropped' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].placeId, 'p1');
  assert.equal(calls[0].unknownKey, undefined);
});

test('handler never throws when the use-case throws', async () => {
  const { logger, handle } = setup(async () => { throw new Error('boom'); });
  await assert.doesNotReject(handle('place.submitted', valid));
  assert.ok(logger.lines.some(([level, m]) => level === 'error' && /boom/.test(m)));
});
