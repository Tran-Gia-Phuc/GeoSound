import { parseArgs } from 'node:util';
import { createSmtpMailer } from '../src/services/smtp-mailer.js';
import { createOtpEmailService } from '../src/services/send-otp-email.js';

// Explicit manual smoke test; it does not create an Auth challenge or consume events.
let mailer;
try {
  const { values } = parseArgs({
    options: { to: { type: 'string' }, purpose: { type: 'string', default: 'register' } },
  });
  if (!values.to) throw new Error('Recipient required');
  mailer = createSmtpMailer();
  const testMailer = {
    send: content => mailer.send({ ...content, subject: `[TEST] ${content.subject}` }),
  };
  const service = createOtpEmailService({
    mailer: testMailer,
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS || 120),
  });
  const result = await service.sendOtp(values.to, '001234', values.purpose);
  console.log(JSON.stringify(result));
  console.log('SMTP accepted the test email. Check Inbox/Spam to confirm receipt. This is not a valid Auth OTP.');
} catch (error) {
  // Avoid printing SMTP responses or validation details containing recipient/code.
  console.error(JSON.stringify({ status: 'failed', code: error.code || 'EMAIL_TEST_FAILED' }));
  console.error('Check --to, --purpose (register/reset_pw), OTP_TTL_SECONDS and SMTP_* configuration.');
  process.exitCode = 1;
} finally {
  mailer?.close();
}
