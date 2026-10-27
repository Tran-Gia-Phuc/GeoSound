// =========================================================
// Helper RabbitMQ: connect (retry) / publish / consume.
// Dùng 1 topic exchange chung; routing key = tên event.
// =========================================================
import amqp from 'amqplib';
import { validateEvent } from '../events/index.js';

const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'geosound.events';
let connection = null;
let channel = null;

/** Kết nối RabbitMQ, tự retry cho tới khi broker sẵn sàng. */
export async function connect(url = process.env.RABBITMQ_URL, { retries = 15, delayMs = 3000 } = {}) {
  for (let i = 1; i <= retries; i++) {
    try {
      connection = await amqp.connect(url);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      console.log('[rabbitmq] connected');
      return channel;
    } catch (err) {
      console.warn(`[rabbitmq] connect fail (${i}/${retries}): ${err.message}`);
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Publish 1 event (payload được validate theo contract trước khi gửi). */
export async function publish(eventName, payload) {
  if (!channel) throw new Error('RabbitMQ chưa connect()');
  const valid = validateEvent(eventName, payload);
  const body = Buffer.from(JSON.stringify(valid));
  channel.publish(EXCHANGE, eventName, body, { persistent: true, contentType: 'application/json' });
  console.log(`[rabbitmq] -> ${eventName}`);
}

/**
 * Consume các event. `bindings` là mảng routing key (hỗ trợ wildcard: 'tour.*').
 * `handler(eventName, payload)` được gọi cho mỗi message hợp lệ.
 * Optional `options.prefetch` (positive integer): max unacked messages per consumer. It is set with
 * basic.qos (global=false) before this consumer starts, so it applies to consumers created afterwards on
 * the shared channel. When omitted, nothing changes (no limit), as before.
 */
export async function consume(queueName, bindings, handler, options = {}) {
  if (!channel) throw new Error('RabbitMQ chưa connect()');
  const { prefetch } = options;
  if (prefetch !== undefined) {
    if (!Number.isInteger(prefetch) || prefetch < 1) throw new Error(`invalid prefetch: ${prefetch}`);
    await channel.prefetch(prefetch);
  }
  const q = await channel.assertQueue(queueName, { durable: true });
  for (const key of bindings) await channel.bindQueue(q.queue, EXCHANGE, key);
  await channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    try {
      const eventName = msg.fields.routingKey;
      const payload = JSON.parse(msg.content.toString());
      await handler(eventName, payload);
      channel.ack(msg);
    } catch (err) {
      console.error('[rabbitmq] handler error:', err.message);
      channel.nack(msg, false, false); // bỏ message lỗi (sau này: dead-letter queue)
    }
  });
  console.log(`[rabbitmq] consuming "${queueName}" <- [${bindings.join(', ')}]`);
}

export async function close() {
  await channel?.close();
  await connection?.close();
}
