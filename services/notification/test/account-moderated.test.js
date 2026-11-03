// =========================================================
// UC21 — account.moderated: email to the account owner (one Vietnamese template per action, with
// the reason, no SECURITY_ALERT_TO override) and one in-app notification for userId (idempotent).
// =========================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEvent } from '../src/notify.js';
import { buildAccountActionEmail, ACCOUNT_MODERATED } from '../src/services/account-email-template.js';
import { buildInAppNotification, sourceKeyOf, IN_APP_EVENTS } from '../src/domain/in-app-notification.js';
import { createStoreInAppNotification } from '../src/application/store-in-app-notification.js';
import { MemoryNotificationRepository } from './helpers/memory-repository.js';

const silent = { log() {}, warn() {}, error() {} };
const AT = '2026-11-03T03:00:00Z';
const UNTIL = '2026-11-10T03:00:00Z'; // 10:00 10/11/2026 Vietnam time
const base = { userId: 'u1', adminId: 'a1', email: 'an@mail.com', fullName: 'Nguyễn An', at: AT };

const CASES = {
  warn: [{ reason: 'Spam nhiều tour' }, 'Tài khoản GeoSound của bạn nhận một cảnh báo', 'Tài khoản của bạn nhận một cảnh báo'],
  suspend: [
    { reason: 'Nội dung sai sự thật', until: UNTIL },
    'Tài khoản GeoSound của bạn bị tạm khoá đến 10:00 10/11/2026 (giờ Việt Nam)',
    'Tài khoản của bạn bị tạm khoá đến 10:00 10/11/2026',
  ],
  ban: [{ reason: 'Lừa đảo' }, 'Tài khoản GeoSound của bạn đã bị cấm', 'Tài khoản của bạn đã bị cấm'],
  restore: [{}, 'Tài khoản GeoSound của bạn đã được khôi phục', 'Tài khoản của bạn đã được khôi phục'],
};

test('email per action: subject, greeting, reason and time; reason escaped in HTML', () => {
  for (const [action, [extra, subject]] of Object.entries(CASES)) {
    const mail = buildAccountActionEmail({ ...base, action, ...extra });
    assert.equal(mail.subject, subject, action);
    assert.match(mail.text, /Xin chào Nguyễn An,/);
    assert.match(mail.text, /Thời gian xử lý: 10:00 03\/11\/2026/);
    if (extra.reason) assert.match(mail.text, new RegExp(`Lý do: ${extra.reason}`));
    else assert.doesNotMatch(mail.text, /Lý do:/);
    assert.match(mail.html, /<html lang="vi">/);
  }
  const xss = buildAccountActionEmail({ ...base, action: 'ban', reason: '<script>alert(1)</script>' });
  assert.doesNotMatch(xss.html, /<script>/);
  assert.match(xss.html, /&lt;script&gt;/);
  assert.equal(buildAccountActionEmail({ ...base, action: 'delete' }), null);
  assert.match(buildAccountActionEmail({ ...base, fullName: undefined, action: 'warn', reason: 'x' }).text, /Xin chào,/);
});

test('in-app per action: recipient userId, title, reason in the body, action / until in data', () => {
  assert.equal(IN_APP_EVENTS.includes(ACCOUNT_MODERATED), false); // tour event list unchanged
  for (const [action, [extra, , title]] of Object.entries(CASES)) {
    const row = buildInAppNotification(ACCOUNT_MODERATED, { ...base, action, ...extra });
    assert.equal(row.userId, 'u1', action);
    assert.equal(row.type, 'account.moderated');
    assert.equal(row.tourId, null);
    assert.equal(row.title, title);
    assert.equal(row.body, extra.reason ?? null);
    assert.deepEqual(row.data, extra.until ? { action, until: UNTIL } : { action });
    assert.match(row.sourceKey, /^account\.moderated:u1:[0-9a-f]{64}$/);
    // Never the admin id or the email in the stored row.
    assert.doesNotMatch(JSON.stringify({ ...row, sourceKey: '' }), /a1|an@mail\.com/);
  }
  assert.equal(buildInAppNotification(ACCOUNT_MODERATED, { ...base, userId: '', action: 'warn' }), null);
  assert.equal(buildInAppNotification(ACCOUNT_MODERATED, { ...base, action: 'constructor' }), null);
  assert.equal(buildInAppNotification(ACCOUNT_MODERATED, null), null);
});

test('source key: a redelivered event maps to the same key; a new action time to a new one', () => {
  const p = { ...base, action: 'warn', reason: 'x' };
  assert.equal(sourceKeyOf(ACCOUNT_MODERATED, p), sourceKeyOf(ACCOUNT_MODERATED, { ...p }));
  assert.notEqual(sourceKeyOf(ACCOUNT_MODERATED, p), sourceKeyOf(ACCOUNT_MODERATED, { ...p, at: '2026-11-03T03:00:01Z' }));
  // Tour events keep their tourId keys.
  assert.match(sourceKeyOf('tour.rejected', { tourId: 't1', userId: 'u9', reason: 'x' }), /^tour\.rejected:t1:/);
});

test('handleEvent: in-app row + email to the account email for each action; duplicate delivery stores once', async () => {
  const repo = new MemoryNotificationRepository();
  const storeInApp = createStoreInAppNotification({ repository: repo, logger: silent });
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { status: 'sent' }; } };
  const env = { SECURITY_ALERT_TO: 'demo@inbox.test' }; // ignored for account emails

  for (const [action, [extra, subject]] of Object.entries(CASES)) {
    const res = await handleEvent(mailer, ACCOUNT_MODERATED, { ...base, action, ...extra }, silent, env, { storeInApp });
    assert.deepEqual(res, { sent: { status: 'sent' } });
    assert.equal(sent.at(-1).to, 'an@mail.com');
    assert.equal(sent.at(-1).subject, subject);
  }
  assert.equal(repo.rows.length, 4);
  assert.deepEqual(repo.rows.map((r) => r.data.action), ['warn', 'suspend', 'ban', 'restore']);

  await handleEvent(mailer, ACCOUNT_MODERATED, { ...base, action: 'warn', ...CASES.warn[0] }, silent, env, { storeInApp });
  assert.equal(repo.rows.length, 4);
});

test('handleEvent: no email -> in-app only; unknown action -> nothing; SMTP failure keeps the in-app row', async () => {
  const repo = new MemoryNotificationRepository();
  const storeInApp = createStoreInAppNotification({ repository: repo, logger: silent });
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { status: 'sent' }; } };

  const noMail = await handleEvent(mailer, ACCOUNT_MODERATED, { ...base, email: undefined, action: 'ban', reason: 'x' }, silent, {}, { storeInApp });
  assert.deepEqual(noMail, { skipped: 'no_recipient' });
  assert.equal(repo.rows.length, 1);

  const unknown = await handleEvent(mailer, ACCOUNT_MODERATED, { ...base, action: 'delete', reason: 'x' }, silent, {}, { storeInApp });
  assert.deepEqual(unknown, { skipped: 'no_template' });
  assert.equal(repo.rows.length, 1);
  assert.equal(sent.length, 0);

  const failure = new Error('SMTP down');
  await assert.rejects(
    handleEvent({ send: async () => { throw failure; } }, ACCOUNT_MODERATED, { ...base, action: 'warn', reason: 'y' }, silent, {}, { storeInApp }),
    (err) => err === failure,
  );
  assert.equal(repo.rows.length, 2);
});
