import test from 'node:test';
import assert from 'node:assert/strict';
import { createOtpEmailService } from '../src/services/send-otp-email.js';
import { createSmtpMailer } from '../src/services/smtp-mailer.js';
import { buildOtpEmail } from '../src/services/otp-email-template.js';

const recipient = 'user@example.com';

for (const purpose of ['register', 'reset_pw']) {
  test(`builds ${purpose} HTML and text and preserves leading zeroes`, async () => {
    const messages = [];
    const result = { status: 'smtp_accepted', messageId: 'test-id' };
    const service = createOtpEmailService({ mailer: { send: async m => { messages.push(m); return result; } } });
    assert.deepEqual(await service.sendOtp(recipient, '001234', purpose), result);
    assert.equal(messages[0].to, recipient);
    assert.match(messages[0].text, /001234/);
    assert.match(messages[0].text, /2 phút/);
    assert.match(messages[0].subject, purpose === 'register' ? /đăng ký/ : /đặt lại mật khẩu/);
    assert.match(messages[0].html, /001234/);
    assert.match(messages[0].html, /lang="vi"/);
    assert.match(messages[0].text, /Không chia sẻ mã/);
  });
}

test('template displays configured lifetime without requiring an event or user ID', () => {
  const email = buildOtpEmail({ code: '123456', purpose: 'reset_pw', ttlSeconds: 90 });
  assert.match(email.text, /90 giây/);
  assert.match(email.html, /90 giây/);
});

test('existing Auth reset alias renders the same template as ERD reset_pw', async () => {
  assert.deepEqual(
    buildOtpEmail({ code: '001234', purpose: 'reset' }),
    buildOtpEmail({ code: '001234', purpose: 'reset_pw' }),
  );
  const messages = [];
  const service = createOtpEmailService({ mailer: { send: async message => messages.push(message) } });
  await service.sendOtp(recipient, '001234', 'reset');
  assert.match(messages[0].subject, /đặt lại mật khẩu/);
});

test('invalid recipients, codes, purposes and lifetimes never reach SMTP', async () => {
  const mailer = { send: async () => assert.fail('must not send') };
  const service = createOtpEmailService({ mailer });
  for (const [to, code, purpose] of [
    ['bad', '001234', 'register'], [recipient, '<html>', 'register'],
    [recipient, '12345', 'register'], [recipient, 123456, 'register'],
    [recipient, '001234', 'login'],
  ]) {
    await assert.rejects(service.sendOtp(to, code, purpose));
  }
  for (const ttlSeconds of [0, -1, 1.5, NaN]) {
    await assert.rejects(createOtpEmailService({ mailer, ttlSeconds }).sendOtp(recipient, '001234', 'register'));
  }
});

test('SMTP errors propagate so the caller can report failed delivery', async () => {
  const failure = new Error('SMTP unavailable');
  const service = createOtpEmailService({ mailer: { send: async () => { throw failure; } } });
  await assert.rejects(service.sendOtp(recipient, '001234', 'register'), error => error === failure);
});

test('SMTP adapter configures TLS, sender and recipient and closes transport', async () => {
  let options, message, closed = false;
  const mailer = createSmtpMailer({ SMTP_HOST: 'localhost', SMTP_PORT: '465', SMTP_FROM: 'no-reply@example.com' }, config => {
    options = config;
    return { sendMail: async m => { message = m; return { accepted: [m.to], rejected: [] }; }, close: () => { closed = true; } };
  });
  assert.deepEqual(await mailer.send({ to: recipient, subject: 'OTP', text: 'test' }), { status: 'smtp_accepted', messageId: undefined });
  assert.equal(options.secure, true);
  assert.equal(message.from, 'no-reply@example.com');
  assert.equal(message.to, recipient);
  mailer.close();
  assert.equal(closed, true);
});

test('SMTP rejection is a delivery failure', async () => {
  const mailer = createSmtpMailer({ SMTP_HOST: 'localhost', SMTP_FROM: 'no-reply@example.com' }, () => ({
    sendMail: async () => ({ accepted: [], rejected: [recipient] }),
  }));
  await assert.rejects(mailer.send({ to: recipient }), { code: 'SMTP_RECIPIENT_REJECTED' });
});

test('invalid SMTP configuration fails before creating a transport', () => {
  for (const env of [{}, { SMTP_HOST: 'localhost', SMTP_FROM: 'a@b.com', SMTP_PORT: 'bad' }, { SMTP_HOST: 'localhost', SMTP_FROM: 'a@b.com', SMTP_USER: 'user' }]) {
    assert.throws(() => createSmtpMailer(env, () => assert.fail('must not create transport')));
  }
});
