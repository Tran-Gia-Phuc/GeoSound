// tour.submitted handler (task #AI-37): validates, delegates, never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTourSubmittedHandler } from '../src/interfaces/events/tour-submitted-consumer.js';
import { FakeLogger, validateEvent } from './helpers/fakes.js';

const valid = {
  tourId: 't1', contributorId: 'u1', revision: '2026-01-01T00:00:00.000Z',
  title: 'Saigon walk', description: 'A walk.', language: 'vi', type: 'walking', durationMinutes: 60,
  places: [{ placeId: 'p1', name: 'Ben Thanh Market', description: 'Market.', lat: 10.77, lng: 106.69, sequence: 0 }],
};

function setup(execute = async () => {}) {
  const calls = [];
  const logger = new FakeLogger();
  const runTourReview = { execute: async (p) => { calls.push(p); return execute(p); } };
  return { calls, logger, handle: createTourSubmittedHandler({ runTourReview, validate: validateEvent, logger }) };
}

test('needs a validate function', () => {
  assert.throws(() => createTourSubmittedHandler({ runTourReview: {} }), TypeError);
});

test('invalid payload is logged and dropped without calling the use-case', async () => {
  const { calls, logger, handle } = setup();
  await assert.doesNotReject(handle('tour.submitted', { ...valid, type: 'boat', revision: '2026-01-01T07:00:00+07:00' }));
  assert.equal(calls.length, 0);
  assert.ok(logger.lines.some(([level, m]) => level === 'warn' && /tourId=t1/.test(m) && /type/.test(m) && /revision/.test(m)));
  assert.ok(!logger.lines.some(([, m]) => m.includes('Saigon walk')), 'content is never logged');
});

test('valid payload runs the use-case with the parsed payload', async () => {
  const { calls, handle } = setup();
  await handle('tour.submitted', { ...valid, unknownKey: 'dropped' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tourId, 't1');
  assert.equal(calls[0].unknownKey, undefined);
});

test('old event shape (tourId, contributorId only) is still accepted and delegated', async () => {
  const { calls, handle } = setup();
  await handle('tour.submitted', { tourId: 't1', contributorId: 'u1' });
  assert.equal(calls.length, 1);
});

test('handler never throws when the use-case throws', async () => {
  const { logger, handle } = setup(async () => { throw new Error('boom'); });
  await assert.doesNotReject(handle('tour.submitted', valid));
  assert.ok(logger.lines.some(([level, m]) => level === 'error' && /boom/.test(m)));
});
