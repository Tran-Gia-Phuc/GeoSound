// #258 — contributor email lookup in Auth (fake fetch, no network) and its use in handleEvent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContributorLookup, contributorLookupFromEnv } from '../src/services/contributor-lookup.js';
import { handleEvent } from '../src/notify.js';

const silent = { log() {}, warn() {} };

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { impl, calls };
}
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function recordingMailer() {
  const sent = [];
  return { sent, async send(msg) { sent.push(msg); return { status: 'sent' }; } };
}

test('lookup is off without AUTH_SERVICE_URL or INTERNAL_SERVICE_TOKEN', () => {
  assert.equal(createContributorLookup({ baseUrl: '', token: 'x' }), null);
  assert.equal(createContributorLookup({ baseUrl: 'http://auth:3001', token: ' ' }), null);
  assert.equal(contributorLookupFromEnv({}), null);
  assert.equal(typeof contributorLookupFromEnv({ AUTH_SERVICE_URL: 'http://auth:3001', INTERNAL_SERVICE_TOKEN: 't' }), 'function');
});

test('lookup calls the internal route with the token and returns the email', async () => {
  const f = fakeFetch(() => json(200, { id: 'u 1', email: 'an@mail.com', fullName: 'An' }));
  const lookup = createContributorLookup({ baseUrl: 'http://auth:3001/', token: 'secret-token', fetchImpl: f.impl });
  assert.equal(await lookup('u 1'), 'an@mail.com');
  assert.equal(f.calls[0].url, 'http://auth:3001/internal/users/u%201/contact');
  assert.equal(f.calls[0].init.headers['x-internal-token'], 'secret-token');
  assert.equal(f.calls[0].init.redirect, 'error');
  assert.ok(f.calls[0].init.signal);
});

test('lookup: 404 gives null, other errors throw', async () => {
  const notFound = createContributorLookup({ baseUrl: 'http://a', token: 't', fetchImpl: async () => json(404, {}) });
  assert.equal(await notFound('u1'), null);
  const broken = createContributorLookup({ baseUrl: 'http://a', token: 't', fetchImpl: async () => json(500, {}) });
  await assert.rejects(broken('u1'), /500/);
});

test('handleEvent looks the email up when the event has only contributorId', async () => {
  const mailer = recordingMailer();
  const asked = [];
  const lookupEmail = async (id) => {
    asked.push(id);
    return 'an@mail.com';
  };
  const res = await handleEvent(mailer, 'tour.approved', { tourId: 't1', contributorId: 'u1' }, silent, {}, { lookupEmail });
  assert.deepEqual(asked, ['u1']);
  assert.equal(mailer.sent[0].to, 'an@mail.com');
  assert.ok(res.sent);
});

test('handleEvent keeps contributorEmail from the event without a lookup', async () => {
  const mailer = recordingMailer();
  const lookupEmail = async () => assert.fail('no lookup expected');
  await handleEvent(mailer, 'tour.approved', { tourId: 't1', contributorId: 'u1', contributorEmail: 'x@mail.com' }, silent, {}, { lookupEmail });
  assert.equal(mailer.sent[0].to, 'x@mail.com');
});

test('handleEvent skips (no throw) when the lookup fails or finds nobody', async () => {
  const mailer = recordingMailer();
  const warnings = [];
  const logger = { log() {}, warn: (m) => warnings.push(m) };
  const failing = async () => {
    throw new Error('auth down');
  };
  const r1 = await handleEvent(mailer, 'tour.rejected', { tourId: 't1', contributorId: 'u1' }, logger, {}, { lookupEmail: failing });
  assert.deepEqual(r1, { skipped: 'no_recipient' });
  assert.ok(warnings.some((w) => /auth down/.test(w)));
  const r2 = await handleEvent(mailer, 'tour.rejected', { tourId: 't1', contributorId: 'u1' }, silent, {}, { lookupEmail: async () => null });
  assert.deepEqual(r2, { skipped: 'no_recipient' });
  assert.equal(mailer.sent.length, 0);
});
