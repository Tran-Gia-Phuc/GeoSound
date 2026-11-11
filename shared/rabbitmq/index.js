// =========================================================
// RabbitMQ helper: connect (retry) / publish / consume.
// One shared topic exchange; routing key = event name.
//
// Reconnect (deployment plan task 0.4, issue #345): when the connection or the channel closes
// without close() being called (broker restart, network cut), the helper reconnects with
// backoff, re-asserts the exchange and re-registers every consumer in the same order (with the
// same prefetch). Messages that were not acked are redelivered by the broker. isReady() is the
// readiness check.
// =========================================================
import amqp from 'amqplib';
import { validateEvent } from '../events/index.js';

const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'geosound.events';
const NOT_CONNECTED = 'RabbitMQ chưa connect()';

let amqpLib = amqp;
let url = null;
let connection = null;
let channel = null;
let closing = false;
let reconnecting = false;
let reconnectDelayMs = 1000;
let maxReconnectDelayMs = 30000;
// Registered consumers, replayed after a reconnect: { queueName, bindings, handler, options }.
let consumers = [];

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
}

function onLost(conn) {
  if (closing || conn !== connection) return;
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
    while (!closing) {
      await sleep(delay);
      if (closing) return;
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
    if (!closing && !channel) reconnect();
  }
}

/**
 * Connects to RabbitMQ, retrying until the broker is up. After a successful connect, a lost
 * connection is re-opened in the background.
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
    try {
      await open();
      console.log('[rabbitmq] connected');
      return channel;
    } catch (err) {
      console.warn(`[rabbitmq] connect fail (${i}/${retries}): ${err.message}`);
      if (i === retries) throw err;
      await sleep(delayMs);
    }
  }
}

/** True while a channel is open (readiness check). */
export function isReady() {
  return Boolean(channel) && !closing;
}

/** Publishes one event (the payload is validated against the contract first). */
export async function publish(eventName, payload) {
  if (!channel) throw new Error(NOT_CONNECTED);
  const valid = validateEvent(eventName, payload);
  const body = Buffer.from(JSON.stringify(valid));
  channel.publish(EXCHANGE, eventName, body, { persistent: true, contentType: 'application/json' });
  console.log(`[rabbitmq] -> ${eventName}`);
}

async function startConsumer({ queueName, bindings, handler, options }) {
  const ch = channel;
  if (!ch) throw new Error(NOT_CONNECTED);
  const { prefetch } = options;
  if (prefetch !== undefined) await ch.prefetch(prefetch);
  const q = await ch.assertQueue(queueName, { durable: true });
  for (const key of bindings) await ch.bindQueue(q.queue, EXCHANGE, key);
  await ch.consume(q.queue, async (msg) => {
    if (!msg) return;
    // Ack on the channel that delivered the message: after a reconnect the old one is closed,
    // the ack fails and the broker redelivers the message.
    try {
      const eventName = msg.fields.routingKey;
      const payload = JSON.parse(msg.content.toString());
      await handler(eventName, payload);
      ch.ack(msg);
    } catch (err) {
      console.error('[rabbitmq] handler error:', err.message);
      try {
        ch.nack(msg, false, false); // drop the failed message (later: dead-letter queue)
      } catch {
        // channel already closed: the broker redelivers the message
      }
    }
  });
}

/**
 * Consumes events. `bindings` = routing keys (wildcards allowed: 'tour.*').
 * `handler(eventName, payload)` runs for each valid message.
 * Optional `options.prefetch` (positive integer): max unacked messages per consumer. It is set with
 * basic.qos (global=false) before this consumer starts, so it applies to consumers created afterwards on
 * the shared channel. When omitted, nothing changes (no limit), as before.
 */
export async function consume(queueName, bindings, handler, options = {}) {
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
