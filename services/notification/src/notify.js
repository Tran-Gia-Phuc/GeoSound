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

async function handleNewDeviceLogin(mailer, payload, logger, env) {
  const to = securityAlertRecipient(payload, env);
  if (!to) {
    logger.warn(`[notification] ${NEW_DEVICE_LOGIN} thiếu email (userId=${payload.userId}) -> không gửi được email.`);
    return { skipped: 'no_recipient' };
  }
  const result = await mailer.send({ to, ...buildNewDeviceEmail(payload) });
  logger.log(`[notification] email "${NEW_DEVICE_LOGIN}" (userId=${payload.userId}): ${result.status}`);
  return { sent: result };
}

// UC21 — in-app first (never throws), then the email; SMTP errors propagate like the tour emails.
async function handleAccountModerated(mailer, payload, logger, deps) {
  if (deps.storeInApp) await deps.storeInApp(ACCOUNT_MODERATED, payload);
  const email = buildAccountActionEmail(payload);
  if (!email) {
    logger.warn(`[notification] ${ACCOUNT_MODERATED}: hành động không xác định (${payload.action}), bỏ qua email.`);
    return { skipped: 'no_template' };
  }
  if (!payload.email) {
    logger.warn(`[notification] ${ACCOUNT_MODERATED} thiếu email (userId=${payload.userId}) -> không gửi được email.`);
    return { skipped: 'no_recipient' };
  }
  const result = await mailer.send({ to: payload.email, ...email });
  logger.log(`[notification] email "${ACCOUNT_MODERATED}" (${payload.action}, userId=${payload.userId}): ${result.status}`);
  return { sent: result };
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
 */
export async function handleEvent(mailer, event, payload = {}, logger = console, env = process.env, deps = {}) {
  if (event === NEW_DEVICE_LOGIN) return handleNewDeviceLogin(mailer, payload, logger, env);
  if (event === ACCOUNT_MODERATED) return handleAccountModerated(mailer, payload, logger, deps);
  if (deps.storeInApp) await deps.storeInApp(event, payload);

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
  const result = await mailer.send({ to, ...email });
  logger.log(`[notification] email "${event}" -> ${to}: ${result.status}`);
  return { sent: result };
}
