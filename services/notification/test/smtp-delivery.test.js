import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createSmtpMailer } from '../src/services/smtp-mailer.js';
import { createOtpEmailService } from '../src/services/send-otp-email.js';
import { buildOtpEmail } from '../src/services/otp-email-template.js';

// Minimal loopback SMTP sink: exercises real Nodemailer serialization and SMTP
// DATA/acceptance/rejection without an external account or third-party delivery.
async function smtpSink(t, { rejectRecipient = false } = {}) {
  const messages = [];
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    let buffer = '', data = null;
    socket.write('220 localhost test SMTP\r\n');
    socket.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== null) {
          if (line === '.') {
            messages.push(data.join('\r\n'));
            data = null;
            socket.write('250 2.0.0 queued\r\n');
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
        } else if (/^(EHLO|HELO) /i.test(line)) {
          socket.write('250 localhost\r\n');
        } else if (/^RCPT TO:/i.test(line) && rejectRecipient) {
          socket.write('550 5.1.1 Recipient rejected\r\n');
        } else if (line === 'DATA') {
          data = [];
          socket.write('354 End with a dot\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { messages, port: server.address().port };
}

function decodeQuotedPrintable(value) {
  const decoded = value.replace(/=\r\n/g, '').replace(/=([\dA-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(decoded, 'latin1').toString('utf8');
}

function subjectOf(message) {
  const headers = message.split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ');
  const subject = /^Subject: (.+)$/m.exec(headers)[1];
  return subject.replace(/(\?=)\s+(=\?)/g, '$1$2').replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=/gi, (_, encoding, value) => (
    encoding.toUpperCase() === 'B' ? Buffer.from(value, 'base64').toString('utf8') : decodeQuotedPrintable(value.replace(/_/g, ' '))
  ));
}

function mimeBody(message, type) {
  const boundary = /boundary="([^"]+)"/i.exec(message)[1];
  const part = message.split(`--${boundary}`).find(value => value.includes(`Content-Type: ${type};`));
  assert.ok(part, `${type} part should exist`);
  const separator = part.indexOf('\r\n\r\n');
  const headers = part.slice(0, separator);
  const body = part.slice(separator + 4).trimEnd();
  if (/Content-Transfer-Encoding: base64/i.test(headers)) return Buffer.from(body, 'base64').toString('utf8');
  if (/Content-Transfer-Encoding: quoted-printable/i.test(headers)) return decodeQuotedPrintable(body);
  return body;
}

for (const purpose of ['register', 'reset_pw']) {
  test(`delivers ${purpose} HTML and text over local SMTP`, { timeout: 5_000 }, async t => {
    const sink = await smtpSink(t);
    const mailer = createSmtpMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_FROM: 'GeoSound <no-reply@example.com>' });
    t.after(() => mailer.close());
    const service = createOtpEmailService({ mailer });
    const result = await service.sendOtp('tester@example.com', '001234', purpose);
    assert.equal(result.status, 'smtp_accepted');
    assert.ok(result.messageId);
    assert.equal(sink.messages.length, 1);
    const message = sink.messages[0];
    assert.match(message, /To: tester@example.com/);
    assert.match(message, /From: GeoSound <no-reply@example.com>/);
    const expected = buildOtpEmail({ code: '001234', purpose });
    assert.equal(subjectOf(message), expected.subject);
    assert.equal(mimeBody(message, 'text/plain'), expected.text.replace(/\r?\n/g, '\r\n'));
    assert.equal(mimeBody(message, 'text/html'), expected.html.replace(/\r?\n/g, '\r\n'));
  });
}

test('reports a real SMTP recipient rejection and sends no message', { timeout: 5_000 }, async t => {
  const sink = await smtpSink(t, { rejectRecipient: true });
  const mailer = createSmtpMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_FROM: 'no-reply@example.com' });
  t.after(() => mailer.close());
  const service = createOtpEmailService({ mailer });
  await assert.rejects(service.sendOtp('tester@example.com', '001234', 'register'), { code: 'EENVELOPE' });
  assert.equal(sink.messages.length, 0);
});

const runFile = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/send-test-email.js', import.meta.url));

function testEnvironment(port) {
  return {
    ...process.env,
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port),
    SMTP_FROM: 'no-reply@example.com', SMTP_USER: '', SMTP_PASS: '',
    OTP_TTL_SECONDS: '120',
  };
}

test('manual test script reports SMTP acceptance without logging recipient or sample code', { timeout: 5_000 }, async t => {
  const sink = await smtpSink(t);
  const { stdout, stderr } = await runFile(process.execPath, [script, '--to', 'tester@example.com', '--purpose', 'reset_pw'], { env: testEnvironment(sink.port), timeout: 4_000 });
  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout.split(/\r?\n/)[0]).status, 'smtp_accepted');
  assert.doesNotMatch(stdout, /tester@example.com|001234/);
  assert.equal(sink.messages.length, 1);
  assert.equal(subjectOf(sink.messages[0]), `[TEST] ${buildOtpEmail({ code: '001234', purpose: 'reset_pw' }).subject}`);
});

test('manual test script exits nonzero on SMTP rejection without logging recipient or sample code', { timeout: 5_000 }, async t => {
  const sink = await smtpSink(t, { rejectRecipient: true });
  await assert.rejects(
    runFile(process.execPath, [script, '--to', 'tester@example.com'], { env: testEnvironment(sink.port), timeout: 4_000 }),
    error => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stderr.split(/\r?\n/)[0]).status, 'failed');
      assert.doesNotMatch(error.stderr + error.stdout, /tester@example.com|001234/);
      return true;
    },
  );
  assert.equal(sink.messages.length, 0);
});
