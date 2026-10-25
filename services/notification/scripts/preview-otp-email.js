import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildOtpEmail } from '../src/services/otp-email-template.js';

const directory = new URL('../preview/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const purpose of ['register', 'reset_pw']) {
  const email = buildOtpEmail({ code: '001234', purpose, ttlSeconds: 120 });
  await writeFile(new URL(`${purpose}.html`, directory), email.html, 'utf8');
  await writeFile(new URL(`${purpose}.txt`, directory), email.text, 'utf8');
}
console.log(`Email previews saved to ${fileURLToPath(directory)} (no email sent).`);
