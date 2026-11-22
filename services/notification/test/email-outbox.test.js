// Email outbox: a failed email is stored, resent with backoff when due, deleted once sent, given up
// after MAX_ATTEMPTS; a row claimed by another replica is skipped; the sweeper never overlaps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailOutbox, startEmailSweeper, retryDelayMs, MAX_ATTEMPTS } from '../src/application/email-outbox.js';
import { MemoryPendingEmailRepository } from './helpers/memory-pending-email-repository.js';

const T0 = Date.parse('2026-11-22T08:00:00Z');
const MAIL = { to: 'c@example.com', subject: 'Tour đã bị ẩn', html: '<p>x</p>', text: 'x' };

function setup() {
  const repo = new MemoryPendingEmailRepository();
  const clock = { now: new Date(T0) };
  const sent = [];
  const logs = { warn: [], error: [] };
  const mailer = { down: false, async send(m) { if (this.down) throw new Error('SMTP down'); sent.push(m); return { status: 'sent' }; } };
  const logger = { log() {}, warn: (m) => logs.warn.push(m), error: (m) => logs.error.push(m) };
  const outbox = createEmailOutbox({ repository: repo, mailer, logger, clock: () => clock.now });
  const at = (ms) => { clock.now = new Date(T0 + ms); };
  return { repo, clock, sent, logs, mailer, outbox, at };
}

test('backoff: 1, 2, 4 minutes ... capped at 1 hour', () => {
  assert.deepEqual([1, 2, 3, 7, 8].map(retryDelayMs), [60_000, 120_000, 240_000, 3_600_000, 3_600_000]);
});

test('enqueue stores the email due in 1 minute; sweep sends it once when due and deletes it', async () => {
  const w = setup();
  await w.outbox.enqueue('tour.hidden', MAIL, new Error('SMTP down'));
  assert.equal(w.repo.rows.length, 1);
  assert.equal(w.repo.rows[0].attempts, 1);
  assert.equal(w.repo.rows[0].lastError, 'SMTP down');
  assert.match(w.logs.warn[0], /tour\.hidden.*queued/);

  w.at(59_999);
  assert.deepEqual(await w.outbox.sweep(), { sent: 0, failed: 0 });
  w.at(60_000);
  assert.deepEqual(await w.outbox.sweep(), { sent: 1, failed: 0 });
  assert.deepEqual(w.sent, [MAIL]);
  assert.equal(w.repo.rows.length, 0);
});

test('a failed resend is rescheduled with a longer wait; given up after MAX_ATTEMPTS, kept in the table', async () => {
  const w = setup();
  w.mailer.down = true;
  await w.outbox.enqueue('account.moderated', MAIL, new Error('first'));
  let t = retryDelayMs(1);
  for (let attempts = 2; attempts <= MAX_ATTEMPTS; attempts += 1) {
    w.at(t);
    assert.deepEqual(await w.outbox.sweep(), { sent: 0, failed: 1 });
    assert.equal(w.repo.rows[0].attempts, attempts);
    assert.equal(w.repo.rows[0].nextAttemptAt.getTime(), T0 + t + retryDelayMs(attempts));
    t += retryDelayMs(attempts);
  }
  assert.equal(w.logs.error.length, 1);
  assert.match(w.logs.error[0], /given up/);
  w.mailer.down = false;
  w.at(t + 10 * 3_600_000);
  assert.deepEqual(await w.outbox.sweep(), { sent: 0, failed: 0 });
  assert.equal(w.repo.rows.length, 1);
  assert.equal(w.repo.rows[0].lastError, 'SMTP down');
  assert.equal(w.sent.length, 0);
});

test('a row claimed by another replica first is not sent twice', async () => {
  const w = setup();
  await w.outbox.enqueue('tour.hidden', MAIL, new Error('x'));
  w.at(60_000);
  const other = createEmailOutbox({ repository: w.repo, mailer: w.mailer, logger: { log() {}, warn() {}, error() {} }, clock: () => w.clock.now });
  const results = await Promise.all([w.outbox.sweep(), other.sweep()]);
  assert.equal(results[0].sent + results[1].sent, 1);
  assert.equal(w.sent.length, 1);
});

test('enqueue throws when the store fails (the broker then nacks)', async () => {
  const w = setup();
  w.repo.failNext = new Error('db down');
  await assert.rejects(w.outbox.enqueue('tour.hidden', MAIL, new Error('x')), /db down/);
});

test('sweeper: no overlapping runs, errors logged, stop waits for the run in progress', async () => {
  let release;
  let runs = 0;
  const outbox = { sweep: () => { runs += 1; return new Promise((r) => { release = r; }); } };
  const errors = [];
  let cleared = false;
  const sweeper = startEmailSweeper({
    outbox, intervalMs: 1000, logger: { error: (m) => errors.push(m) },
    setIntervalImpl: () => ({}), clearIntervalImpl: () => { cleared = true; },
  });
  const first = sweeper.tick();
  await sweeper.tick(); // skipped: the first run is still going
  assert.equal(runs, 1);
  const stopping = sweeper.stop();
  release({ sent: 0, failed: 0 });
  await Promise.all([first, stopping]);
  assert.equal(cleared, true);
  await sweeper.tick(); // stopped: no new run
  assert.equal(runs, 1);

  const failing = startEmailSweeper({
    outbox: { sweep: async () => { throw new Error('db down'); } }, intervalMs: 1000,
    logger: { error: (m) => errors.push(m) }, setIntervalImpl: () => ({}), clearIntervalImpl: () => {},
  });
  await failing.tick();
  assert.match(errors[0], /email sweeper failed: db down/);
});
