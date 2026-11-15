// #258 — internal contact lookup for Notification: token guard, gateway refusal, no secrets in the answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { User } from '../src/domain/entities/user.js';
import { GetUserContact } from '../src/application/use-cases/get-user-contact.js';
import { buildInternalRouter } from '../src/interfaces/http/routes/internal-routes.js';

const users = new Map([
  ['u1', new User({ id: 'u1', email: 'an@mail.com', passwordHash: 'h:secret', fullName: 'An', role: 'contributor' })],
]);
const userRepo = { findById: async (id) => users.get(id) ?? null };

async function withApp(internalToken, fn) {
  const app = express();
  app.use('/internal', buildInternalRouter({ getUserContact: new GetUserContact({ userRepo }), internalToken }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('contact: right token -> id, email, fullName only; unknown user -> 404', async () => {
  await withApp('tok-123', async (base) => {
    const res = await fetch(`${base}/internal/users/u1/contact`, { headers: { 'x-internal-token': 'tok-123' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 'u1', email: 'an@mail.com', fullName: 'An' });
    const missing = await fetch(`${base}/internal/users/nope/contact`, { headers: { 'x-internal-token': 'tok-123' } });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'user_not_found');
  });
});

test('contact: missing or wrong token -> 401', async () => {
  await withApp('tok-123', async (base) => {
    assert.equal((await fetch(`${base}/internal/users/u1/contact`)).status, 401);
    const wrong = await fetch(`${base}/internal/users/u1/contact`, { headers: { 'x-internal-token': 'tok-1234' } });
    assert.equal(wrong.status, 401);
  });
});

test('contact: refused through the gateway (x-forwarded-for) and off without a configured token', async () => {
  await withApp('tok-123', async (base) => {
    const res = await fetch(`${base}/internal/users/u1/contact`, {
      headers: { 'x-internal-token': 'tok-123', 'x-forwarded-for': '203.0.113.9' },
    });
    assert.equal(res.status, 404);
  });
  await withApp('', async (base) => {
    const res = await fetch(`${base}/internal/users/u1/contact`, { headers: { 'x-internal-token': '' } });
    assert.equal(res.status, 404);
  });
});
