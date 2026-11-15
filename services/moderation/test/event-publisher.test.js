// EventPublisher (task #AI-36): zod validation before publish, `at` added when missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventPublisher } from '../src/infrastructure/messaging/event-publisher.js';
import { MODERATION_EVENTS } from '../src/application/events.js';
import { validateEvent, EVENTS } from './helpers/fakes.js';

const REV = '2026-01-01T00:00:00.000Z';

function setup() {
  const sent = [];
  const publisher = new EventPublisher({ validate: validateEvent, publish: async (eventName, payload) => { sent.push({ eventName, payload }); } });
  return { sent, publisher };
}

test('adds an `at` ending with Z when missing and publishes the valid payload', async () => {
  const { sent, publisher } = setup();
  await publisher.publish('place.ai_passed', { placeId: 'p1', tourId: 't1', revision: REV, warning: false, severity: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].eventName, 'place.ai_passed');
  assert.match(sent[0].payload.at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
});

test('keeps an existing `at`', async () => {
  const { sent, publisher } = setup();
  await publisher.publish('place.ai_rejected', { placeId: 'p1', tourId: 't1', revision: REV, reason: 'No.', at: REV });
  assert.equal(sent[0].payload.at, REV);
});

test('rejects an invalid payload and publishes nothing', async () => {
  const { sent, publisher } = setup();
  await assert.rejects(publisher.publish('place.ai_rejected', { placeId: 'p1', tourId: 't1', revision: REV, reason: '' }));
  await assert.rejects(publisher.publish('place.ai_passed', { placeId: 'p1', revision: REV }));
  await assert.rejects(publisher.publish('no.such.event', {}));
  assert.equal(sent.length, 0);
});

test('needs injected publish and validate functions', () => {
  assert.throws(() => new EventPublisher({ publish: async () => {} }), TypeError);
  assert.throws(() => new EventPublisher({ validate: validateEvent }), TypeError);
});

test('local event names match the shared contract', () => {
  for (const [key, name] of Object.entries(MODERATION_EVENTS)) assert.equal(EVENTS[key], name, key);
});
