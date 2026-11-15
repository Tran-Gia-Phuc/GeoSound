// =========================================================
// RabbitMQ helper: connect (retry) / publish / consume.
// One shared topic exchange; routing key = event name.
//
// Reconnect (deployment plan task 0.4, issue #345): when the connection or the channel closes
// without close() being called (broker restart, network cut), the helper reconnects with
// backoff, re-asserts the exchange and re-registers every consumer in the same order (with the
// same prefetch). Messages that were not acked are redelivered by the broker. isReady() is the
// readiness check.
//
// Graceful shutdown (task 0.5, issue #348): stopConsuming() cancels the consumers and waits for the
// handlers in flight (they can still publish), then close() closes the channel; anything not acked
// by then goes back to the queue. After stopConsuming() nothing connects or reconnects again.
//
// Metrics (task 4.2, issue #399): useMetrics(metrics) counts published and consumed events.
// =========================================================
import amqp from 'amqplib';
import { validateEvent } from '../events/index.js';

const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'geosound.events';
const NOT_CONNECTED = 'RabbitMQ chưa connect()';
const DRAINING = 'RabbitMQ is shutting down';

let amqpLib = amqp;
let url = null;
let connection = null;
let channel = null;
let closing = false;
let draining = false; // stopConsuming() was called: never connect, reconnect or consume again
let reconnecting = false;
let reconnectDelayMs = 1000;
let maxReconnectDelayMs = 30000;
// Registered consumers, replayed after a reconnect: { queueName, bindings, handler, options }.
let consumers = [];
// Consumer tags on the current channel (cancelled by stopConsuming()).
let consumerTags = [];
// Handlers running now, and the waiters of stopConsuming() for the count to reach 0.
let inFlight = 0;
let idleWaiters = [];
// Event counters set by useMetrics() (metrics task 4.2, issue #399); null = nothing is counted.
let eventMetrics = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens a connection and a channel, asserts the exchange and watches both for an unexpected close. */
async function open() {
  const conn = await amqpLib.connect(url);
  let ch;
  try {
    ch = await conn.createChannel();
    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  } catch (err) {
    await conn.close().catch(() => {});
    throw err;
  }
  conn.on('error', (err) => console.warn(`[rabbitmq] connection error: ${err.message}`));
  conn.on('close', () => onLost(conn));
  ch.on('error', (err) => console.warn(`[rabbitmq] channel error: ${err.message}`));
  // A channel can close alone (for example after a protocol error): close the connection too,
  // so both come back through the same reconnect path.
  ch.on('close', () => {
    if (closing || channel !== ch) return;
    channel = null;
    conn.close().catch(() => onLost(conn));
  });
  connection = conn;
  channel = ch;
  consumerTags = [];
}

function onLost(conn) {
  if (closing || draining || conn !== connection) return;
  connection = null;
  channel = null;
  console.warn('[rabbitmq] connection lost, reconnecting');
  reconnect();
}

/** Reconnects until it works (or close() is called), then re-registers the consumers. */
async function reconnect() {
  if (reconnecting) return;
  reconnecting = true;
  let delay = reconnectDelayMs;
  try {
    while (!closing && !draining) {
      await sleep(delay);
      if (closing || draining) return;
      try {
        await open();
        for (const c of consumers) await startConsumer(c);
        console.log(`[rabbitmq] reconnected (${consumers.length} consumer(s) resumed)`);
        return;
      } catch (err) {
        console.warn(`[rabbitmq] reconnect failed: ${err.message}`);
        const conn = connection;
        connection = null;
        channel = null;
        await conn?.close().catch(() => {});
        delay = Math.min(delay * 2, maxReconnectDelayMs);
      }
    }
  } finally {
    reconnecting = false;
    // The new connection dropped while the consumers were being re-registered: start over.
    if (!closing && !draining && !channel) reconnect();
  }
}

/**
 * Connects to RabbitMQ, retrying until the broker is up. After a successful connect, a lost
 * connection is re-opened in the background. `retries: Infinity` waits for the broker forever
 * (a service that must not stay without consumers when the broker starts late).
 * Options (tests): `amqp` replaces amqplib, `reconnectDelayMs` / `maxReconnectDelayMs` the backoff.
 */
export async function connect(
  brokerUrl = process.env.RABBITMQ_URL,
  { retries = 15, delayMs = 3000, ...opts } = {},
) {
  if (opts.amqp) amqpLib = opts.amqp;
  if (opts.reconnectDelayMs) reconnectDelayMs = opts.reconnectDelayMs;
  if (opts.maxReconnectDelayMs) maxReconnectDelayMs = opts.maxReconnectDelayMs;
  url = brokerUrl;
  closing = false;
  for (let i = 1; i <= retries; i++) {
    if (draining) throw new Error(DRAINING);
    try {
      await open();
      console.log('[rabbitmq] connected');
      return channel;
    } catch (err) {
      const total = Number.isFinite(retries) ? `/${retries}` : '';
      console.warn(`[rabbitmq] connect fail (${i}${total}): ${err.message}`);
      if (i === retries) throw err;
      await sleep(delayMs);
    }
  }
}

/** True while a channel is open (readiness check). */
export function isReady() {
  return Boolean(channel) && !closing && !draining;
}

/**
 * Counts events with the counter factory of shared/metrics (`createMetrics(...)`):
 *   events_published_total{event}         one per publish() handed to the channel;
 *   events_consumed_total{event, result}  one per delivered message, where result is
 *     ack  = the handler succeeded and the message was acked,
 *     nack = the handler threw (or the body was not JSON) and the message was dropped,
 *     skip = the ack / nack could not be sent because the delivering channel had closed
 *            (reconnect or shutdown): the broker redelivers the message.
 * `event` is the routing key, which is always an event name. Without this call nothing is counted.
 */
export function useMetrics(metrics) {
  eventMetrics = {
    published: metrics.counter({
      name: 'events_published_total',
      help: 'Events published to RabbitMQ, by event name',
      labelNames: ['event'],
    }),
    consumed: metrics.counter({
      name: 'events_consumed_total',
      help: 'Events consumed from RabbitMQ, by event name and result (ack, nack, skip)',
      labelNames: ['event', 'result'],
    }),
  };
}

/** Publishes one event (the payload is validated against the contract first). */
export async function publish(eventName, payload) {
  if (!channel) throw new Error(NOT_CONNECTED);
  const valid = validateEvent(eventName, payload);
  const body = Buffer.from(JSON.stringify(valid));
  channel.publish(EXCHANGE, eventName, body, { persistent: true, contentType: 'application/json' });
  eventMetrics?.published.inc({ event: eventName });
  console.log(`[rabbitmq] -> ${eventName}`);
}

async function startConsumer({ queueName, bindings, handler, options }) {
  const ch = channel;
  if (!ch) throw new Error(NOT_CONNECTED);
  const { prefetch } = options;
  if (prefetch !== undefined) await ch.prefetch(prefetch);
  const q = await ch.assertQueue(queueName, { durable: true });
  for (const key of bindings) await ch.bindQueue(q.queue, EXCHANGE, key);
  const { consumerTag } = await ch.consume(q.queue, async (msg) => {
    if (!msg) return;
    inFlight += 1;
    // Ack on the channel that delivered the message: after a reconnect the old one is closed,
    // the ack fails and the broker redelivers the message.
    const eventName = msg.fields.routingKey;
    let result;
    try {
      const payload = JSON.parse(msg.content.toString());
      await handler(eventName, payload);
      result = 'ack';
    } catch (err) {
      console.error('[rabbitmq] handler error:', err.message);
      result = 'nack';
    }
    try {
      if (result === 'ack') ch.ack(msg);
      else ch.nack(msg, false, false); // drop the failed message (later: dead-letter queue)
    } catch {
      // channel already closed: the broker redelivers the message
      console.warn(`[rabbitmq] ${result} of ${eventName} not sent (channel closed): the broker redelivers it`);
      result = 'skip';
    } finally {
      eventMetrics?.consumed.inc({ event: eventName, result });
      inFlight -= 1;
      if (inFlight === 0) for (const resolve of idleWaiters.splice(0)) resolve();
    }
  });
  if (channel === ch) consumerTags.push(consumerTag);
}

/**
 * Consumes events. `bindings` = routing keys (wildcards allowed: 'tour.*').
 * `handler(eventName, payload)` runs for each valid message.
 * Optional `options.prefetch` (positive integer): max unacked messages per consumer. It is set with
 * basic.qos (global=false) before this consumer starts, so it applies to consumers created afterwards on
 * the shared channel. When omitted, nothing changes (no limit), as before.
 */
export async function consume(queueName, bindings, handler, options = {}) {
  if (draining) throw new Error(DRAINING);
  if (!channel) throw new Error(NOT_CONNECTED);
  const { prefetch } = options;
  if (prefetch !== undefined && (!Number.isInteger(prefetch) || prefetch < 1)) {
    throw new Error(`invalid prefetch: ${prefetch}`);
  }
  const registration = { queueName, bindings, handler, options };
  await startConsumer(registration);
  consumers.push(registration);
  console.log(`[rabbitmq] consuming "${queueName}" <- [${bindings.join(', ')}]`);
}

/**
 * First half of a graceful shutdown: cancels every consumer (the broker stops delivering), then
 * waits until the handlers in flight are done, at most `timeoutMs`. The channel stays open so those
 * handlers can still ack and publish; call close() afterwards. Returns { pending } = handlers still
 * running when it gave up (their messages are redelivered once the channel closes).
 */
export async function stopConsuming({ timeoutMs = 20000 } = {}) {
  draining = true;
  consumers = [];
  const ch = channel;
  const tags = consumerTags;
  consumerTags = [];
  for (const tag of tags) await ch?.cancel(tag).catch(() => {});
  if (inFlight > 0) {
    let timer;
    await Promise.race([
      new Promise((resolve) => idleWaiters.push(resolve)),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
  }
  if (inFlight > 0) console.warn(`[rabbitmq] ${inFlight} handler(s) still running: their messages go back to the queue`);
  else console.log('[rabbitmq] consumers stopped, nothing in flight');
  return { pending: inFlight };
}

/** Closes the channel and the connection; no reconnect after this. */
export async function close() {
  closing = true;
  const ch = channel;
  const conn = connection;
  channel = null;
  connection = null;
  consumers = [];
  await ch?.close().catch(() => {});
  await conn?.close().catch(() => {});
}
