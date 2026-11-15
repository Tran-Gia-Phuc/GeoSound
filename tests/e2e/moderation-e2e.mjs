// Moderation end-to-end test (task #AI-40, issue #181).
// Plays the Tour side against the running stack: publishes place.submitted / tour.submitted on RabbitMQ and
// waits for place.ai_passed | place.ai_rejected | tour.ai_passed | tour.ai_rejected from Moderation.
// Meant to run with the AI stub (tests/e2e/ai-stub), which turns the markers E2E_REJECT, E2E_WARN and E2E_422
// into fixed verdicts. See docs/03-testing/moderation-e2e.md.
//
// Env:
//   RABBITMQ_URL       broker URL (default amqp://guest:guest@localhost:5672). Never printed.
//   RABBITMQ_EXCHANGE  topic exchange (default geosound.events)
//   E2E_TIMEOUT_MS     wait per result (default 60000)
//   E2E_AI_STUB_URL    optional, e.g. http://ai-stub:3004: enables the "AI called once" idempotency check
//
// Exit code 0 when every scenario passes, 1 otherwise.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import amqp from 'amqplib';

const here = dirname(fileURLToPath(import.meta.url));
// Repo layout: tests/e2e -> ../../shared. Inside the moderation image (/app/e2e): ../shared.
const sharedEvents = [resolve(here, '../../shared/events/index.js'), resolve(here, '../shared/events/index.js')]
  .find((p) => existsSync(p));
if (!sharedEvents) {
  console.error('[e2e] cannot find shared/events/index.js');
  process.exit(1);
}
const { EVENTS, validateEvent } = await import(pathToFileURL(sharedEvents).href);

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'geosound.events';
const TIMEOUT_MS = Number.parseInt(process.env.E2E_TIMEOUT_MS ?? '60000', 10);
const STUB_URL = (process.env.E2E_AI_STUB_URL ?? '').replace(/\/+$/, '');
const RESULT_KEYS = [EVENTS.PLACE_AI_PASSED, EVENTS.PLACE_AI_REJECTED, EVENTS.TOUR_AI_PASSED, EVENTS.TOUR_AI_REJECTED];

const runId = `e2e-${Date.now().toString(36)}`;
const id = (name) => `${runId}-${name}`;
// Distinct revisions even when two events are built in the same millisecond.
let revisionOffset = 0;
const newRevision = () => new Date(Date.now() + (revisionOffset += 1)).toISOString();

// Hanoi, Hoan Kiem lake. ~0.0045 deg lat = 500 m; ~0.09 deg lat = 10 km.
const BASE = { lat: 21.0285, lng: 105.8542 };

function placeEvent(name, overrides = {}) {
  return {
    placeId: id(name),
    tourId: id('tour-of-places'),
    contributorId: 'e2e-contributor',
    revision: newRevision(),
    name: 'Hoan Kiem Lake',
    type: 'landmark',
    description: 'A calm lake in the centre of Hanoi with the Turtle Tower and the red Huc bridge.',
    language: 'en',
    lat: BASE.lat,
    lng: BASE.lng,
    city: 'Hanoi',
    at: new Date().toISOString(),
    ...overrides,
  };
}

function tourEvent(name, { title = 'Old Quarter walk', places, ...overrides } = {}) {
  const tourId = id(name);
  return {
    tourId,
    contributorId: 'e2e-contributor',
    revision: newRevision(),
    title,
    description: 'A short walk around Hoan Kiem lake and the Old Quarter.',
    language: 'en',
    city: 'Hanoi',
    type: 'walking',
    durationMinutes: 180,
    places: (places ?? [[0, 0], [0.0045, 0]]).map(([dLat, dLng], i) => ({
      placeId: `${tourId}-p${i + 1}`,
      name: `Stop ${i + 1}`,
      type: 'landmark',
      description: 'A historic place near the lake.',
      lat: BASE.lat + dLat,
      lng: BASE.lng + dLng,
      sequence: i,
    })),
    at: new Date().toISOString(),
    ...overrides,
  };
}

// --- broker plumbing ---------------------------------------------------------------------------------------

const received = [];
let wake = () => {};

async function connectBroker() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  const q = await channel.assertQueue('', { exclusive: true, autoDelete: true });
  for (const key of RESULT_KEYS) await channel.bindQueue(q.queue, EXCHANGE, key);
  await channel.consume(q.queue, (msg) => {
    if (!msg) return;
    let payload = null;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch {
      // ignore non-JSON
    }
    if (payload) received.push({ eventName: msg.fields.routingKey, payload });
    wake();
  }, { noAck: true });
  return { connection, channel };
}

function publish(channel, eventName, payload) {
  const valid = validateEvent(eventName, payload); // same contract check as the shared publish()
  channel.publish(EXCHANGE, eventName, Buffer.from(JSON.stringify(valid)), {
    persistent: true, contentType: 'application/json',
  });
}

// Waits for the `nth` (1-based) result matching the subject id and revision.
async function waitFor({ kind, subjectId, revision, nth = 1 }) {
  const deadline = Date.now() + TIMEOUT_MS;
  const matches = () => received.filter(({ eventName, payload }) => eventName.startsWith(`${kind}.`)
    && payload[`${kind}Id`] === subjectId && payload.revision === revision);
  for (;;) {
    const found = matches();
    if (found.length >= nth) return found[nth - 1];
    const left = deadline - Date.now();
    if (left <= 0) return null;
    await new Promise((r) => {
      const t = setTimeout(r, Math.min(left, 1000));
      wake = () => { clearTimeout(t); r(); };
    });
  }
}

async function stubCalls(subjectId) {
  const res = await fetch(`${STUB_URL}/stats?id=${encodeURIComponent(subjectId)}`);
  if (!res.ok) throw new Error(`stub /stats answered ${res.status}`);
  return (await res.json()).calls;
}

// --- assertions --------------------------------------------------------------------------------------------

function check(cond, message) {
  if (!cond) throw new Error(message);
}

const expectPassed = (event, kind, { warning, source, category } = {}) => {
  check(event.eventName === `${kind}.ai_passed`, `expected ${kind}.ai_passed, got ${event.eventName}`);
  const { payload } = event;
  check(Boolean(payload.warning) === warning, `expected warning=${warning}, got ${payload.warning}`);
  if (warning) {
    const reasons = payload.reasons ?? [];
    check(reasons.length > 0, 'expected at least one reason');
    if (source) check(reasons.some((r) => r.source === source), `expected a reason with source=${source}`);
    if (category) check(reasons.some((r) => r.category === category), `expected a reason with category=${category}`);
  } else {
    check((payload.reasons ?? []).length === 0, 'expected no reasons on a clean Pass');
  }
  validateEvent(event.eventName, payload);
};

const expectRejected = (event, kind, { category, source }) => {
  check(event.eventName === `${kind}.ai_rejected`, `expected ${kind}.ai_rejected, got ${event.eventName}`);
  const { payload } = event;
  check(typeof payload.reason === 'string' && payload.reason.length > 0, 'expected a non-empty reason');
  const reasons = payload.reasons ?? [];
  check(reasons.some((r) => r.category === category && r.source === source),
    `expected a reason category=${category} source=${source}`);
  validateEvent(event.eventName, payload);
};

const summary = (event) => {
  const p = event.payload;
  const reasons = (p.reasons ?? []).map((r) => `${r.source}:${r.category}`).join(',');
  return `${event.eventName}${p.warning ? ' warning' : ''} sev=${p.severity ?? '-'} [${reasons}]`;
};

// --- scenarios ---------------------------------------------------------------------------------------------

const scenarios = [
  {
    name: 'place Pass',
    kind: 'place',
    event: () => placeEvent('place-pass'),
    assert: (e) => expectPassed(e, 'place', { warning: false }),
  },
  {
    name: 'place Pass with 2 images',
    kind: 'place',
    event: () => placeEvent('place-images', {
      images: [{ url: 'https://example.com/a.jpg', caption: 'Lake' }, { url: 'https://example.com/b.jpg' }],
    }),
    assert: (e) => expectPassed(e, 'place', { warning: false }),
  },
  {
    name: 'place Warning',
    kind: 'place',
    event: () => placeEvent('place-warn', { description: 'Best lake in the world, E2E_WARN guaranteed.' }),
    assert: (e) => expectPassed(e, 'place', { warning: true, source: 'ai', category: 'misleading' }),
  },
  {
    name: 'place Reject',
    kind: 'place',
    event: () => placeEvent('place-reject', { description: 'Send money first to book E2E_REJECT.' }),
    assert: (e) => expectRejected(e, 'place', { category: 'scam', source: 'ai' }),
  },
  {
    name: 'place AI 422 -> Warning',
    kind: 'place',
    event: () => placeEvent('place-422', { description: 'Input the AI refuses E2E_422.' }),
    assert: (e) => expectPassed(e, 'place', { warning: true, source: 'ai', category: 'other' }),
  },
  {
    name: 'tour Pass',
    kind: 'tour',
    event: () => tourEvent('tour-pass'),
    assert: (e) => expectPassed(e, 'tour', { warning: false }),
  },
  {
    name: 'tour geo Warning (10 km leg)',
    kind: 'tour',
    event: () => tourEvent('tour-geo', { places: [[0, 0], [0.09, 0]] }),
    assert: (e) => expectPassed(e, 'tour', { warning: true, source: 'geo', category: 'route' }),
  },
  {
    name: 'tour content Reject',
    kind: 'tour',
    event: () => tourEvent('tour-reject', { title: 'Cheap tickets E2E_REJECT' }),
    assert: (e) => expectRejected(e, 'tour', { category: 'scam', source: 'ai' }),
  },
];

async function runScenario(channel, s) {
  const event = s.event();
  const eventName = s.kind === 'place' ? EVENTS.PLACE_SUBMITTED : EVENTS.TOUR_SUBMITTED;
  const subjectId = s.kind === 'place' ? event.placeId : event.tourId;
  const started = Date.now();
  publish(channel, eventName, event);
  const result = await waitFor({ kind: s.kind, subjectId, revision: event.revision });
  if (!result) throw new Error(`no result within ${TIMEOUT_MS} ms`);
  s.assert(result);
  return { detail: summary(result), ms: Date.now() - started };
}

// Same place event published twice: two results, same verdict, and (with the stub) only one AI call.
async function runDuplicate(channel) {
  const event = placeEvent('place-duplicate');
  const started = Date.now();
  publish(channel, EVENTS.PLACE_SUBMITTED, event);
  const first = await waitFor({ kind: 'place', subjectId: event.placeId, revision: event.revision });
  if (!first) throw new Error(`no first result within ${TIMEOUT_MS} ms`);
  publish(channel, EVENTS.PLACE_SUBMITTED, event);
  const second = await waitFor({ kind: 'place', subjectId: event.placeId, revision: event.revision, nth: 2 });
  if (!second) throw new Error(`no second result within ${TIMEOUT_MS} ms`);
  check(first.eventName === second.eventName, 'the two results differ');
  let calls = 'n/a';
  if (STUB_URL) {
    calls = await stubCalls(event.placeId);
    check(calls === 1, `expected 1 AI call, got ${calls}`);
  }
  return { detail: `2 x ${first.eventName}, AI calls=${calls}`, ms: Date.now() - started };
}

function printTable(rows) {
  const head = ['#', 'Scenario', 'Result', 'Time', 'Detail'];
  const body = rows.map((r, i) => [String(i + 1), r.name, r.ok ? 'PASS' : 'FAIL', `${r.ms} ms`, r.detail]);
  const widths = head.map((h, c) => Math.max(h.length, ...body.map((b) => b[c].length)));
  const line = (cells) => `| ${cells.map((v, c) => v.padEnd(widths[c])).join(' | ')} |`;
  console.log(line(head));
  console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
  for (const b of body) console.log(line(b));
}

async function main() {
  console.log(`[e2e] run ${runId}, exchange ${EXCHANGE}, timeout ${TIMEOUT_MS} ms per result`);
  let broker;
  try {
    broker = await connectBroker();
  } catch (err) {
    // amqplib error messages do not contain the URL credentials.
    console.error(`[e2e] cannot connect to RabbitMQ: ${err.message}`);
    process.exit(1);
  }
  const rows = [];
  const all = [...scenarios.map((s) => ({ name: s.name, run: () => runScenario(broker.channel, s) })),
    { name: 'place duplicate revision', run: () => runDuplicate(broker.channel) }];
  // Sequential on purpose: keeps the AI call rate low and the output easy to read.
  for (const s of all) {
    const started = Date.now();
    try {
      const { detail, ms } = await s.run();
      rows.push({ name: s.name, ok: true, ms, detail });
    } catch (err) {
      rows.push({ name: s.name, ok: false, ms: Date.now() - started, detail: err.message });
    }
  }
  await broker.channel.close().catch(() => {});
  await broker.connection.close().catch(() => {});
  printTable(rows);
  const failed = rows.filter((r) => !r.ok).length;
  console.log(failed === 0 ? `[e2e] ${rows.length}/${rows.length} PASS` : `[e2e] ${failed} FAIL of ${rows.length}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
