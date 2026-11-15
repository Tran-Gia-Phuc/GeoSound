// UC01 — the OTP email sent by Auth has an HTML version; a bad input falls back to plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodemailerMailer, otpMessage } from '../src/infrastructure/mail/nodemailer-mailer.js';
import { buildOtpEmail } from '../src/infrastructure/mail/otp-email-template.js';

test('register and reset OTP emails: subject, text and HTML with the code and lifetime', () => {
  const reg = otpMessage('123456', 'register', 120);
  assert.equal(reg.subject, 'Mã OTP đăng ký GeoSound');
  assert.match(reg.text, /Mã OTP: 123456/);
  assert.match(reg.text, /2 phút/);
  assert.match(reg.html, /lang="vi"/);
  assert.match(reg.html, />123456</);
  const reset = otpMessage('000042', 'reset', 90);
  assert.equal(reset.subject, 'Mã OTP đặt lại mật khẩu GeoSound');
  assert.match(reset.text, /90 giây/);
  assert.deepEqual(buildOtpEmail({ code: '000042', purpose: 'reset_pw', ttlSeconds: 90 }), reset);
});

test('an input the template refuses still gives the plain text email (never blocks sign-up)', () => {
  const msg = otpMessage('12ab', 'other', 120);
  assert.equal(msg.subject, 'Mã OTP GeoSound');
  assert.equal(msg.text, 'Mã OTP của bạn là: 12ab. Mã có hiệu lực trong 2 phút.');
  assert.equal(msg.html, undefined);
});

test('NodemailerMailer.sendOtp sends text + html through the transport', async () => {
  const sent = [];
  const mailer = new NodemailerMailer({ from: 'GeoSound <no-reply@example.test>', otpTtlSeconds: 120, transport: { sendMail: async (m) => sent.push(m) } });
  await mailer.sendOtp('user@example.test', '654321', 'register');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'user@example.test');
  assert.equal(sent[0].from, 'GeoSound <no-reply@example.test>');
  assert.match(sent[0].html, /654321/);
  assert.match(sent[0].text, /654321/);
});
