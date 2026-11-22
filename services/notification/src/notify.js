// =========================================================
// Logic xử lý 1 event -> gửi email cho contributor (UC16).
// UC23 / R10: auth.new_device_login -> security email to the account owner, or to
// SECURITY_ALERT_TO when set (demo inbox, configured only in .env).
// UC21: account.moderated -> in-app notification for userId + email to the account email
// (warning / suspended until / banned / restored, with the reason; no SECURITY_ALERT_TO override).
// Tách khỏi index.js (không import shared/) để unit-test được cục bộ.
// =========================================================
import { buildTourEmail } from './services/tour-email-template.js';
import { buildNewDeviceEmail, NEW_DEVICE_LOGIN } from './services/security-email-template.js';
import { buildAccountActionEmail, ACCOUNT_MODERATED } from './services/account-email-template.js';

/** Recipient of a security alert: the demo override when configured, else the account email. */
export function securityAlertRecipient(payload = {}, env = process.env) {
  const override = String(env.SECURITY_ALERT_TO ?? '').trim();
  return override || payload.email || null;
}

// The shared consume() drops a message whose handler throws, and a redelivery skips the email
// (duplicate in-app row), so a failed send goes to the email outbox (application/email-outbox.js),
// which resends it later. Without an outbox, or when storing it fails, the error propagates (nack).
async function sendOrQueue(mailer, event, mail, deps) {
  try {
    return await mailer.send(mail);
  } catch (err) {
    if (!deps.queueEmail) throw err;
    await deps.queueEmail(event, mail, err);
    return { status: 'queued' };
  }
}

async function handleNewDeviceLogin(mailer, payload, logger, env, deps) {
  const to = securityAlertRecipient(payload, env);
  if (!to) {
    logger.warn(`[notification] ${NEW_DEVICE_LOGIN} thiếu email (userId=${payload.userId}) -> không gửi được email.`);
    return { skipped: 'no_recipient' };
  }
  const result = await sendOrQueue(mailer, NEW_DEVICE_LOGIN, { to, ...buildNewDeviceEmail(payload) }, deps);
  logger.log(`[notification] email "${NEW_DEVICE_LOGIN}" (userId=${payload.userId}): ${result.status}`);
  return { sent: result };
}

// UC21 — in-app first (never throws), then the email; a failed email is queued like the tour emails.
async function handleAccountModerated(mailer, payload, logger, deps) {
  if (await isDuplicate(deps.storeInApp, ACCOUNT_MODERATED, payload, logger)) return { skipped: 'duplicate' };
  const email = buildAccountActionEmail(payload);
  if (!email) {
    logger.warn(`[notification] ${ACCOUNT_MODERATED}: hành động không xác định (${payload.action}), bỏ qua email.`);
    return { skipped: 'no_template' };
  }
  if (!payload.email) {
    logger.warn(`[notification] ${ACCOUNT_MODERATED} thiếu email (userId=${payload.userId}) -> không gửi được email.`);
    return { skipped: 'no_recipient' };
  }
  const result = await sendOrQueue(mailer, ACCOUNT_MODERATED, { to: payload.email, ...email }, deps);
  logger.log(`[notification] email "${ACCOUNT_MODERATED}" (${payload.action}, userId=${payload.userId}): ${result.status}`);
  return { sent: result };
}

// A redelivered event (its in-app row already exists) was mailed on the first delivery: do not mail
// it again. Only the 'duplicate' answer skips the email; a storage failure still sends it.
async function isDuplicate(storeInApp, event, payload, logger) {
  if (!storeInApp) return false;
  const stored = await storeInApp(event, payload);
  if (stored?.skipped !== 'duplicate') return false;
  logger.log(`[notification] ${event}: duplicate delivery, email already sent, skipped.`);
  return true;
}

// #258 — no contributorEmail in the event: ask Auth by contributorId (best effort, never throws).
async function contributorEmailOf(payload, lookupEmail, logger) {
  if (payload.contributorEmail) return payload.contributorEmail;
  if (!lookupEmail || !payload.contributorId) return null;
  try {
    return await lookupEmail(payload.contributorId);
  } catch (err) {
    logger.warn(`[notification] tra email contributorId=${payload.contributorId} thất bại: ${err.message}`);
    return null;
  }
}

/**
 * @param {{ lookupEmail?: ((userId: string) => Promise<string|null>) | null,
 *           storeInApp?: ((event: string, payload: object) => Promise<object>) | null }} [deps]
 *   lookupEmail = contributor email lookup in Auth (services/contributor-lookup.js)
 *   storeInApp  = UC16 in-app notification (application/store-in-app-notification.js). It never
 *                 throws and runs before the email, so an SMTP failure does not lose the in-app row.
 *   queueEmail  = email outbox enqueue (application/email-outbox.js): a failed send is stored and resent
 *                 later instead of throwing. Without it, SMTP errors propagate.
 */
export async function handleEvent(mailer, event, payload = {}, logger = console, env = process.env, deps = {}) {
  if (event === NEW_DEVICE_LOGIN) return handleNewDeviceLogin(mailer, payload, logger, env, deps);
  if (event === ACCOUNT_MODERATED) return handleAccountModerated(mailer, payload, logger, deps);
  if (await isDuplicate(deps.storeInApp, event, payload, logger)) return { skipped: 'duplicate' };

  const email = buildTourEmail({ event, payload });
  if (!email) {
    logger.log(`[notification] ${event}: không có mẫu email cho contributor, bỏ qua.`);
    return { skipped: 'no_template' };
  }
  const to = await contributorEmailOf(payload, deps.lookupEmail ?? null, logger);
  if (!to) {
    logger.warn(`[notification] ${event} thiếu contributorEmail (tourId=${payload.tourId}) -> không gửi được email.`);
    return { skipped: 'no_recipient' };
  }
  const result = await sendOrQueue(mailer, event, { to, ...email }, deps);
  logger.log(`[notification] email "${event}" -> ${to}: ${result.status}`);
  return { sent: result };
}
