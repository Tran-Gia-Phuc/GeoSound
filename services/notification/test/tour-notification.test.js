import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTourEmail } from '../src/services/tour-email-template.js';
import { handleEvent } from '../src/notify.js';
import { createMailer } from '../src/services/mailer.js';

const silent = { log() {}, warn() {} };

test('builds a contributor email for every tour event that needs one', () => {
  for (const event of ['tour.approved', 'tour.rejected', 'tour.ai_rejected', 'tour.hidden', 'tts.render.completed']) {
    const email = buildTourEmail({ event, payload: { tourId: 't1', tourTitle: 'Phố cổ Hội An' } });
    assert.ok(email, `${event} phải có email`);
    assert.ok(email.subject.length > 0);
    assert.match(email.html, /lang="vi"/);
    assert.match(email.html, /Phố cổ Hội An/);
    assert.match(email.text, /Phố cổ Hội An/);
  }
});

test('reported events do not email the contributor', () => {
  assert.equal(buildTourEmail({ event: 'tour.reported', payload: { tourId: 't1', count: 5 } }), null);
  assert.equal(buildTourEmail({ event: 'unknown.event', payload: {} }), null);
});

test('rejection reason appears in both text and html', () => {
  const email = buildTourEmail({ event: 'tour.rejected', payload: { tourId: 't1', reason: 'Nội dung trùng lặp' } });
  assert.match(email.text, /Lý do: Nội dung trùng lặp/);
  assert.match(email.html, /Nội dung trùng lặp/);
});

test('missing title falls back to a neutral phrase without duplicating "của bạn"', () => {
  const email = buildTourEmail({ event: 'tour.rejected', payload: { tourId: 't1' } });
  assert.match(email.text, /tour của bạn chưa được duyệt/);
  assert.doesNotMatch(email.text, /của bạn của bạn/);
});

test('reason and title are HTML-escaped to block injection', () => {
  const email = buildTourEmail({
    event: 'tour.hidden',
    payload: { tourId: 't1', tourTitle: '<b>x</b>', reason: '<script>alert(1)</script>' },
  });
  assert.doesNotMatch(email.html, /<script>/);
  assert.doesNotMatch(email.html, /<b>x<\/b>/);
  assert.match(email.html, /&lt;script&gt;/);
});

test('handleEvent sends an email when contributorEmail is present', async () => {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { status: 'console_logged' }; } };
  const res = await handleEvent(mailer, 'tour.approved', { tourId: 't1', contributorEmail: 'c@example.com', tourTitle: 'A' }, silent);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'c@example.com');
  assert.match(sent[0].subject, /được duyệt/);
  assert.deepEqual(res, { sent: { status: 'console_logged' } });
});

test('handleEvent skips sending when the recipient email is missing', async () => {
  const mailer = { send: async () => assert.fail('must not send') };
  const res = await handleEvent(mailer, 'tour.approved', { tourId: 't1', tourTitle: 'A' }, silent);
  assert.deepEqual(res, { skipped: 'no_recipient' });
});

test('handleEvent skips events without a contributor template', async () => {
  const mailer = { send: async () => assert.fail('must not send') };
  const res = await handleEvent(mailer, 'tour.reported', { tourId: 't1', count: 3, contributorEmail: 'c@example.com' }, silent);
  assert.deepEqual(res, { skipped: 'no_template' });
});

test('handleEvent lets SMTP errors propagate so the broker can nack the message', async () => {
  const failure = new Error('SMTP down');
  const mailer = { send: async () => { throw failure; } };
  await assert.rejects(
    handleEvent(mailer, 'tour.rejected', { tourId: 't1', contributorEmail: 'c@example.com', reason: 'x' }, silent),
    (err) => err === failure,
  );
});

test('createMailer falls back to a console mailer when SMTP is not configured', async () => {
  const mailer = createMailer({}, silent);
  assert.deepEqual(await mailer.send({ to: 'c@example.com', subject: 'hi' }), { status: 'console_logged', messageId: undefined });
});

test('createMailer builds a real SMTP mailer when host and sender are set', () => {
  const mailer = createMailer({ SMTP_HOST: 'localhost', SMTP_FROM: 'no-reply@example.com', SMTP_PORT: '587' }, silent);
  assert.equal(typeof mailer.send, 'function');
  mailer.close();
});

test('tour.changes_requested (UC19) emails the contributor with the escaped reason', () => {
  const email = buildTourEmail({
    event: 'tour.changes_requested',
    payload: { tourId: 't1', tourTitle: 'Phố cổ Hội An', reason: 'Thêm ảnh <b>điểm 2</b>' },
  });
  assert.equal(email.subject, 'Tour cần chỉnh sửa');
  assert.match(email.text, /Phố cổ Hội An/);
  assert.match(email.text, /Lý do: Thêm ảnh <b>điểm 2<\/b>/);
  assert.match(email.html, /Thêm ảnh &lt;b&gt;điểm 2&lt;\/b&gt;/);
  assert.doesNotMatch(email.html, /<b>điểm 2<\/b>/);
});

test('handleEvent sends the changes-requested email', async () => {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { status: 'console_logged' }; } };
  await handleEvent(mailer, 'tour.changes_requested', { tourId: 't1', contributorEmail: 'c@example.com', reason: 'Sửa mô tả' }, silent);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Tour cần chỉnh sửa');
});
