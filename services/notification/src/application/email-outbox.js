// =========================================================
// Email outbox: an email whose SMTP send failed is kept in pending_emails and resent later.
// Why: the shared consume() drops a message whose handler throws, and a redelivery skips the email
// (its in-app row already exists), so without this a short SMTP outage loses the email.
//   enqueue(event, mail, err)  store the failed email (throws when the database is down: the broker
//                              then nacks the message, as before this outbox)
//   sweep()                    resend the due emails; never throws per email (errors are logged)
// Backoff 1, 2, 4, ... minutes, capped at 1 hour; after MAX_ATTEMPTS sends the email is given up
// (row kept with its last error). Several replicas: a row is claimed with a conditional update first.
// =========================================================

export const MAX_ATTEMPTS = 8; // about 3 hours of retries
const BASE_DELAY_MS = 60_000;
const MAX_DELAY_MS = 3_600_000;
const BATCH = 20;

/** Wait before the next send, after `attempts` failed sends. */
export const retryDelayMs = (attempts) => Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);

const errorText = (err) => String(err?.message ?? err).slice(0, 500);

/**
 * @param {{ repository: { add, due, claim, remove, recordError }, mailer: { send: Function },
 *           logger?: Pick<Console, 'log' | 'warn' | 'error'>, clock?: () => Date }} deps
 */
export function createEmailOutbox({ repository, mailer, logger = console, clock = () => new Date() }) {
  const later = (now, attempts) => new Date(now.getTime() + retryDelayMs(attempts));

  async function enqueue(event, mail, err) {
    await repository.add({
      event,
      to: mail.to,
      subject: mail.subject,
      html: mail.html ?? null,
      text: mail.text ?? null,
      attempts: 1,
      nextAttemptAt: later(clock(), 1),
      lastError: errorText(err),
    });
    logger.warn(`[notification] email "${event}" -> ${mail.to} failed (${errorText(err)}), queued for a retry`);
  }

  async function sweep() {
    const now = clock();
    const result = { sent: 0, failed: 0 };
    for (const row of await repository.due(now, MAX_ATTEMPTS, BATCH)) {
      const attempts = row.attempts + 1;
      // Another replica that read the same row loses this conditional update and skips it.
      if (!(await repository.claim(row.id, row.nextAttemptAt, { attempts, nextAttemptAt: later(now, attempts) }))) continue;
      try {
        await mailer.send({ to: row.to, subject: row.subject, html: row.html ?? undefined, text: row.text ?? undefined });
        await repository.remove(row.id);
        result.sent += 1;
        logger.log(`[notification] queued email "${row.event}" -> ${row.to}: sent (attempt ${attempts})`);
      } catch (err) {
        result.failed += 1;
        await repository.recordError(row.id, errorText(err)).catch(() => {});
        const msg = `[notification] queued email "${row.event}" -> ${row.to}: attempt ${attempts} failed (${errorText(err)})`;
        if (attempts >= MAX_ATTEMPTS) logger.error(`${msg}, given up`);
        else logger.warn(msg);
      }
    }
    return result;
  }

  return { enqueue, sweep };
}

/**
 * Timer around sweep(): no overlapping runs, errors logged, stop() waits for the run in progress.
 * @returns {{ tick: () => Promise<void>, stop: () => Promise<void> }}
 */
export function startEmailSweeper({ outbox, intervalMs, logger = console, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  let running = null;
  let stopped = false;
  async function tick() {
    if (stopped || running) return;
    running = outbox.sweep()
      .catch((err) => logger.error(`[notification] email sweeper failed: ${errorText(err)}`))
      .finally(() => { running = null; });
    await running;
  }
  const handle = setIntervalImpl(() => tick(), intervalMs);
  handle?.unref?.();
  return {
    tick,
    async stop() {
      stopped = true;
      clearIntervalImpl(handle);
      await running;
    },
  };
}
