# Notification

Current scope: design and test OTP email templates for UC01. The team lead will
provide event names and payloads later. UC16 remains an existing worker skeleton.

## Standalone OTP module

`createOtpEmailService({ mailer, ttlSeconds = 120 })` exposes
`sendOtp(to, code, purpose)`, matching Auth's current local mailer API. It renders
Vietnamese registration/reset HTML and plain text and uses an injected mailer.
The [general ERD](../../docs/02-design/drawio/erd-general.drawio) defines
`OTP_CODES.purpose` as `register|reset_pw`; use those values for new template
calls. Existing Auth's `reset` spelling is accepted as an alias for `reset_pw`.
These are local method arguments, not an event contract. Auth owns code
generation and expiry; `ttlSeconds` only controls the displayed lifetime.
Its default of 120 seconds matches the ERD's two-minute expiry. OTP storage and
verification are outside this module. The ERD's `NOTIFICATIONS.delivery` is
`in_app|push`; email testing does not write OTPs or SMTP outcomes to that table.
`createSmtpMailer(env)` supplies the Nodemailer adapter using existing `SMTP_HOST`,
`SMTP_PORT`, `SMTP_FROM`, and optional paired `SMTP_USER`/`SMTP_PASS` variables.
Port 465 uses implicit TLS; other ports use Nodemailer's STARTTLS negotiation.
No OTP or recipient is logged by these modules.

These modules are **not wired into `src/index.js`**. Starting the current worker
does not enable OTP delivery. Auth continues to send its own OTP email.
See [the template design and test sequence](../../docs/02-design/notification-otp-design.md).

## Preview templates without sending

From the repository root:

```sh
npm run email:preview --workspace=@geosound/notification
```

Open `services/notification/preview/register.html` and `reset_pw.html` in a browser.
Matching `.txt` files show the plain-text versions. These generated files use
sample code `001234` and are ignored by Git. HTML previews are design artifacts;
mail-client rendering should also be checked in a mailbox test.

## Manual SMTP smoke test

Use Node.js 20.6+ and install dependencies first. Configure `SMTP_HOST`,
`SMTP_PORT`, `SMTP_FROM`, and if required `SMTP_USER`/`SMTP_PASS` in the root
`.env` file (use `.env.example` as a reference). `OTP_TTL_SECONDS` defaults to 120.
Keep credentials out of commits. The script loads `.env` without overriding
existing shell environment variables.

Replace the sample recipient with your own test mailbox before running:

```sh
npm run email:test --workspace=@geosound/notification -- --to your-test-address@example.com --purpose register
npm run email:test --workspace=@geosound/notification -- --to your-test-address@example.com --purpose reset_pw
```

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.
These commands explicitly send email. The subject has a `[TEST]` prefix and
sample code `001234` cannot authenticate an account. They do not call Auth,
RabbitMQ or the database.

- Success: JSON with `status: "smtp_accepted"` and SMTP message ID; exit code 0.
- Failure: JSON with `status: "failed"` and a diagnostic code; nonzero exit code.
- Check the recipient's Inbox/Spam to confirm delivery and review both templates.
  SMTP acceptance alone does not prove mailbox receipt.

## Tests

From the repository root after installing dependencies:

```sh
npm test --workspace=@geosound/notification
```

Tests include fake transports and a temporary SMTP sink on `127.0.0.1`. The real
Nodemailer transport sends both templates to that local sink and MIME content is
verified. Recipient rejection is also tested. No external recipients, SMTP
credentials, RabbitMQ or database are needed.
