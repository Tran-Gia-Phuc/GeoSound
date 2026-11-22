// =========================================================
// UC16 (#270) — consumed event -> stored in-app notification: each event type, reason in the body,
// no contributorId -> nothing stored, duplicate delivery -> one row, storage errors never throw,
// and the email behaviour of handleEvent is unchanged.
// =========================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInAppNotification, sourceKeyOf, IN_APP_EVENTS } from '../src/domain/in-app-notification.js';
import { createStoreInAppNotification } from '../src/application/store-in-app-notification.js';
import { handleEvent } from '../src/notify.js';
import { MemoryNotificationRepository } from './helpers/memory-repository.js';

const silent = { log() {}, warn() {}, error() {} };
const AT = '2026-11-03T08:00:00Z';
const base = { tourId: 't1', contributorId: 'u1', tourTitle: 'Phố cổ Hội An', at: AT };

const CASES = {
  'tour.ai_rejected': [{ reason: 'Mô tả chứa lời lẽ xúc phạm' }, 'Tour «Phố cổ Hội An» không qua kiểm duyệt tự động'],
  'tour.approved': [{ adminId: 'a1' }, 'Tour «Phố cổ Hội An» đã được duyệt'],
  'tour.rejected': [{ reason: 'Nội dung trùng lặp' }, 'Tour «Phố cổ Hội An» bị từ chối'],
  'tour.changes_requested': [{ reason: 'Thêm ảnh điểm 2' }, 'Tour «Phố cổ Hội An» cần chỉnh sửa'],
  'tour.hidden': [{ reason: 'Nhiều báo cáo sai sự thật' }, 'Tour «Phố cổ Hội An» đã bị ẩn'],
  'tour.restored': [{ reason: 'Báo cáo không đúng' }, 'Tour «Phố cổ Hội An» đã được hiển thị lại'],
  'tour.reported': [{ reason: 'Thông tin sai', count: 3, flagged: false }, 'Tour «Phố cổ Hội An» bị khách báo cáo'],
  'tts.render.completed': [{ assets: [{ lang: 'vi', url: 'https://x.test/a.mp3' }] }, 'Thuyết minh của tour «Phố cổ Hội An» đã sẵn sàng'],
};

test('every in-app event maps to a notification for the tour author, reason in the body', () => {
  assert.deepEqual(Object.keys(CASES).sort(), [...IN_APP_EVENTS].sort());
  for (const [event, [extra, title]] of Object.entries(CASES)) {
    const row = buildInAppNotification(event, { ...base, ...extra });
    assert.equal(row.userId, 'u1', event);
    assert.equal(row.type, event);
    assert.equal(row.tourId, 't1');
    assert.equal(row.title, title);
    assert.equal(row.body, extra.reason ?? null, event);
    assert.match(row.sourceKey, new RegExp(`^${event.replace(/\./g, '\\.')}:t1:[0-9a-f]{64}$`));
  }
});

test('titles fall back to "tour của bạn" without a tour title; long titles are clipped', () => {
  assert.equal(buildInAppNotification('tour.rejected', { tourId: 't1', contributorId: 'u1', reason: 'x' }).title, 'Tour của bạn bị từ chối');
  assert.equal(buildInAppNotification('tts.render.completed', { tourId: 't1', contributorId: 'u1' }).title, 'Thuyết minh cho tour của bạn đã sẵn sàng');
  const long = buildInAppNotification('tour.approved', { ...base, tourTitle: 'A'.repeat(500) });
  assert.ok(long.title.length < 200);
  const longReason = buildInAppNotification('tour.rejected', { ...base, reason: 'r'.repeat(5000) });
  assert.equal(longReason.body.length, 1000);
});

test('data keeps only whitelisted keys: AI reasons, report count and flag; never reporter identity', () => {
  const ai = buildInAppNotification('tour.ai_rejected', {
    ...base,
    reason: 'a; b',
    reasons: [
      { field: 'description', category: 'hate', message: 'Lời lẽ xúc phạm', source: 'ai', severity: 0.9 },
      { field: 'title', category: 'other', message: '' },
    ],
  });
  assert.deepEqual(ai.data, { reasons: [{ field: 'description', category: 'hate', message: 'Lời lẽ xúc phạm' }] });

  const rep = buildInAppNotification('tour.reported', {
    ...base, reason: 'Sai địa điểm', count: 5, flagged: true, reporterId: 'r9', reporterName: 'Lan', userId: 'r9',
  });
  assert.deepEqual(rep.data, { count: 5, flagged: true });
  assert.doesNotMatch(JSON.stringify({ ...rep, sourceKey: '' }), /r9|Lan/);

  assert.deepEqual(buildInAppNotification('tour.approved', { ...base, adminId: 'a1' }).data, {});
});

test('no contributorId, unknown event or bad payload -> nothing to store', () => {
  assert.equal(buildInAppNotification('tour.rejected', { tourId: 't1', reason: 'x' }), null);
  assert.equal(buildInAppNotification('tour.reported', { tourId: 't1', count: 2 }), null);
  assert.equal(buildInAppNotification('tour.rejected', { ...base, contributorId: '  ' }), null);
  assert.equal(buildInAppNotification('auth.new_device_login', { userId: 'u1', contributorId: 'u1' }), null);
  assert.equal(buildInAppNotification('tour.ai_passed', base), null);
  assert.equal(buildInAppNotification('tour.rejected', null), null);
});

test('source key: same payload (any key order) -> same key; new `at` or count -> new key', () => {
  const a = sourceKeyOf('tour.rejected', { tourId: 't1', reason: 'x', at: AT });
  assert.equal(a, sourceKeyOf('tour.rejected', { at: AT, reason: 'x', tourId: 't1' }));
  assert.notEqual(a, sourceKeyOf('tour.rejected', { tourId: 't1', reason: 'x', at: '2026-11-03T08:00:01Z' }));
  assert.notEqual(a, sourceKeyOf('tour.hidden', { tourId: 't1', reason: 'x', at: AT }));
  assert.notEqual(
    sourceKeyOf('tour.reported', { tourId: 't1', count: 1 }),
    sourceKeyOf('tour.reported', { tourId: 't1', count: 2 }),
  );
});

test('store: stored once, duplicate delivery ignored, no recipient skipped', async () => {
  const repo = new MemoryNotificationRepository();
  const store = createStoreInAppNotification({ repository: repo, logger: silent });
  const payload = { ...base, reason: 'Nội dung trùng lặp' };
  assert.deepEqual(await store('tour.rejected', payload), { stored: true });
  assert.deepEqual(await store('tour.rejected', { ...payload }), { skipped: 'duplicate' });
  assert.deepEqual(await store('tour.rejected', { tourId: 't2', reason: 'x' }), { skipped: 'no_recipient' });
  assert.equal(repo.rows.length, 1);
  assert.equal(repo.rows[0].body, 'Nội dung trùng lặp');
});

test('store: a storage error is logged and never thrown', async () => {
  const repo = new MemoryNotificationRepository();
  const errors = [];
  const store = createStoreInAppNotification({ repository: repo, logger: { ...silent, error: (m) => errors.push(m) } });
  repo.failNext = new Error('connection refused');
  assert.deepEqual(await store('tour.hidden', { ...base, reason: 'x' }), { failed: true });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /tour\.hidden/);
  // A later delivery works again.
  assert.deepEqual(await store('tour.hidden', { ...base, reason: 'x' }), { stored: true });
});

test('handleEvent stores in-app first, then emails exactly as before', async () => {
  const repo = new MemoryNotificationRepository();
  const storeInApp = createStoreInAppNotification({ repository: repo, logger: silent });
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { status: 'console_logged' }; } };

  const res = await handleEvent(mailer, 'tour.rejected', { ...base, contributorEmail: 'c@example.com', reason: 'x' }, silent, {}, { storeInApp });
  assert.deepEqual(res, { sent: { status: 'console_logged' } });
  assert.equal(sent.length, 1);
  assert.equal(repo.rows.length, 1);

  // tour.reported: no email template (unchanged) but an in-app notification for the author.
  const rep = await handleEvent(mailer, 'tour.reported', { ...base, count: 3, reason: 'Sai' }, silent, {}, { storeInApp });
  assert.deepEqual(rep, { skipped: 'no_template' });
  assert.equal(repo.rows.length, 2);

  // No contributorId: nothing stored, email logic unchanged (no recipient).
  const none = await handleEvent(mailer, 'tour.approved', { tourId: 't9', adminId: 'a1' }, silent, {}, { storeInApp });
  assert.deepEqual(none, { skipped: 'no_recipient' });
  assert.equal(repo.rows.length, 2);

  // New-device sign-in is email only.
  await handleEvent(mailer, 'auth.new_device_login', { userId: 'u1', email: 'a@b.c', deviceName: 'x' }, silent, {}, { storeInApp });
  assert.equal(repo.rows.length, 2);
});

test('handleEvent: storage failure does not stop the email; SMTP failure keeps the in-app row', async () => {
  const repo = new MemoryNotificationRepository();
  const storeInApp = createStoreInAppNotification({ repository: repo, logger: silent });
  const sent = [];
  const okMailer = { send: async (m) => { sent.push(m); return { status: 'sent' }; } };
  repo.failNext = new Error('db down');
  await handleEvent(okMailer, 'tour.hidden', { ...base, contributorEmail: 'c@example.com', reason: 'x' }, silent, {}, { storeInApp });
  assert.equal(sent.length, 1);
  assert.equal(repo.rows.length, 0);

  const failure = new Error('SMTP down');
  const badMailer = { send: async () => { throw failure; } };
  await assert.rejects(
    handleEvent(badMailer, 'tour.changes_requested', { ...base, contributorEmail: 'c@example.com', reason: 'Sửa' }, silent, {}, { storeInApp }),
    (err) => err === failure,
  );
  assert.equal(repo.rows.length, 1);
});
