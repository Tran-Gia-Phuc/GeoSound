// Tests for shared/rabbitmq reconnect and isReady() (issue #345) and stopConsuming() (issue #348)
// with a fake amqplib.
// No broker: the fake records every call and lets the test drop the connection.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as rabbit from '../rabbitmq/index.js';

class FakeChannel extends EventEmitter {
  constructor(conn) {
    super();
    this.conn = conn;
    this.calls = [];
    this.consumers = [];
    this.published = [];
    this.acked = [];
    this.nacked = [];
    this.cancelled = [];
    this.closed = false;
  }
  async assertExchange(name, type) { this.calls.push(['assertExchange', name, type]); }
  async prefetch(n) { this.calls.push(['prefetch', n]); }
  async assertQueue(name) { this.calls.push(['assertQueue', name]); return { queue: name }; }
  async bindQueue(q, ex, key) { this.calls.push(['bindQueue', q, key]); }
  async consume(q, fn) {
    this.calls.push(['consume', q]);
    const consumerTag = `ctag-${this.consumers.length + this.cancelled.length + 1}`;
    this.consumers.push({ q, fn, consumerTag });
    return { consumerTag };
  }
  async cancel(tag) {
    this.cancelled.push(tag);
    this.consumers = this.consumers.filter((c) => c.consumerTag !== tag);
  }
  publish(ex, key, body) { this.published.push({ key, body: JSON.parse(body.toString()) }); return true; }
  ack(msg) {
    if (this.closed) throw new Error('Channel closed');
    this.acked.push(msg);
  }
  nack(msg) {
    if (this.closed) throw new Error('Channel closed');
    this.nacked.push(msg);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
  // Delivers one message to the consumer of queue `q`.
  async deliver(q, routingKey, payload) {
    const c = this.consumers.find((x) => x.q === q);
    const msg = { fields: { routingKey }, content: Buffer.from(JSON.stringify(payload)) };
    await c.fn(msg);
    return msg;
  }
}

class FakeConnection extends EventEmitter {
  constructor() {
    super();
    this.channels = [];
    this.closed = false;
  }
  async createChannel() {
    const ch = new FakeChannel(this);
    this.channels.push(ch);
    return ch;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const ch of this.channels) {
      ch.closed = true;
      ch.emit('close');
    }
    this.emit('close');
  }
  // Broker gone: the connection closes by itself (amqplib emits 'error' then 'close').
  drop() {
    this.emit('error', new Error('Connection closed: 320 (CONNECTION-FORCED)'));
    this.close();
  }
}

// Fake amqplib: `up` decides whether connect() works.
function fakeAmqp() {
  const lib = {
    up: true,
    attempts: 0,
    connections: [],
    async connect() {
      lib.attempts += 1;
      if (!lib.up) throw new Error('ECONNREFUSED');
      const conn = new FakeConnection();
      lib.connections.push(conn);
      return conn;
    },
    get conn() { return lib.connections.at(-1); },
    get channel() { return lib.conn?.channels.at(-1); },
  };
  return lib;
}

const waitFor = async (cond, ms = 1000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const opts = (amqp) => ({ amqp, retries: 3, delayMs: 5, reconnectDelayMs: 5, maxReconnectDelayMs: 20 });

// The module logs every step; keep the test output short.
const original = { log: console.log, warn: console.warn, error: console.error };
console.log = () => {};
console.warn = () => {};
console.error = () => {};

afterEach(async () => {
  await rabbit.close();
});

test.after(() => Object.assign(console, original));

test('before connect(): not ready, publish and consume throw the old message', async () => {
  assert.equal(rabbit.isReady(), false);
  await assert.rejects(rabbit.publish('tour.published', {}), /RabbitMQ chưa connect\(\)/);
  await assert.rejects(rabbit.consume('q', ['x'], () => {}), /RabbitMQ chưa connect\(\)/);
});

test('connect() retries until the broker is up, then gives up after `retries`', async () => {
  const amqp = fakeAmqp();
  amqp.up = false;
  await assert.rejects(rabbit.connect('amqp://x', opts(amqp)), /ECONNREFUSED/);
  assert.equal(amqp.attempts, 3);
  assert.equal(rabbit.isReady(), false);

  const amqp2 = fakeAmqp();
  amqp2.up = false;
  setTimeout(() => { amqp2.up = true; }, 7);
  await rabbit.connect('amqp://x', opts(amqp2));
  assert.equal(rabbit.isReady(), true);
  assert.deepEqual(amqp2.channel.calls[0], ['assertExchange', 'geosound.events', 'topic']);
});

test('consume(): prefetch is checked and set before the consumer starts', async () => {
  const amqp = fakeAmqp();
  await rabbit.connect('amqp://x', opts(amqp));
  await assert.rejects(rabbit.consume('q', ['a'], () => {}, { prefetch: 0 }), /invalid prefetch/);
  await rabbit.consume('q', ['a', 'b'], () => {}, { prefetch: 2 });
  assert.deepEqual(amqp.channel.calls.slice(1), [
    ['prefetch', 2],
    ['assertQueue', 'q'],
    ['bindQueue', 'q', 'a'],
    ['bindQueue', 'q', 'b'],
    ['consume', 'q'],
  ]);
});

test('consume(): ack on success, nack on handler error', async () => {
  const amqp = fakeAmqp();
  await rabbit.connect('amqp://x', opts(amqp));
  const seen = [];
  await rabbit.consume('q', ['tour.*'], async (name, payload) => {
    if (payload.fail) throw new Error('nope');
    seen.push([name, payload]);
  });
  const ch = amqp.channel;
  const ok = await ch.deliver('q', 'tour.published', { tourId: 't1' });
  const bad = await ch.deliver('q', 'tour.published', { fail: true });
  assert.deepEqual(seen, [['tour.published', { tourId: 't1' }]]);
  assert.deepEqual(ch.acked, [ok]);
  assert.deepEqual(ch.nacked, [bad]);
});

test('a lost connection reconnects and re-registers every consumer in order', async () => {
  const amqp = fakeAmqp();
  await rabbit.connect('amqp://x', opts(amqp));
  const seen = [];
  await rabbit.consume('first', ['place.submitted'], (n) => seen.push(['first', n]), { prefetch: 1 });
  await rabbit.consume('second', ['tour.*'], (n) => seen.push(['second', n]));
  const firstConn = amqp.conn;

  amqp.up = false;
  firstConn.drop();
  assert.equal(rabbit.isReady(), false);
  await assert.rejects(rabbit.publish('tour.published', {}), /RabbitMQ chưa connect\(\)/);

  await new Promise((r) => setTimeout(r, 30)); // a few failed attempts with backoff
  assert.equal(rabbit.isReady(), false);
  amqp.up = true;
  await waitFor(() => rabbit.isReady() && amqp.channel.consumers.length === 2);

  assert.notEqual(amqp.conn, firstConn);
  assert.deepEqual(amqp.channel.calls, [
    ['assertExchange', 'geosound.events', 'topic'],
    ['prefetch', 1],
    ['assertQueue', 'first'],
    ['bindQueue', 'first', 'place.submitted'],
    ['consume', 'first'],
    ['assertQueue', 'second'],
    ['bindQueue', 'second', 'tour.*'],
    ['consume', 'second'],
  ]);

  // Messages flow on the new channel.
  await amqp.channel.deliver('second', 'tour.published', { tourId: 't1' });
  assert.deepEqual(seen, [['second', 'tour.published']]);
  assert.equal(amqp.channel.acked.length, 1);
});

test('a message finished after the reconnect is not acked on the old channel (no throw)', async () => {
  const amqp = fakeAmqp();
  await rabbit.connect('amqp://x', opts(amqp));
  let release;
  await rabbit.consume('q', ['a'], () => new Promise((r) => { release = r; }));
  const oldChannel = amqp.channel;
  const pending = oldChannel.deliver('q', 'a', {});

  amqp.conn.drop();
  await waitFor(() => rabbit.isReady());
  release();
  await pending; // ack on the closed channel fails quietly; the broker redelivers
  assert.equal(oldChannel.acked.length, 0);
  assert.equal(amqp.channel.acked.length, 0);
});

test('a channel that closes alone also triggers a full reconnect', async () => {
  const amqp = fakeAmqp();
  await rabbit.connect('amqp://x', opts(amqp));
  await rabbit.consume('q', ['a'], () => {});
  const firstConn = amqp.conn;
  await amqp.channel.close(); // channel-level error, the connection stays open
  await waitFor(() => rabbit.isReady() && amqp.conn !== firstConn);
  assert.equal(firstConn.closed, true);
  assert.equal(amqp.channel.consumers.length, 1);
});

test('publish() validates the payload and goes to the current channel', async () => {
  const amqp = fakeAmqp();
  await rabbit.connect('amqp://x', opts(amqp));
  await assert.rejects(rabbit.publish('tour.published', { nope: true }));
  amqp.conn.drop();
  await waitFor(() => rabbit.isReady());
  await rabbit.publish('tour.unpublished', { tourId: 't1', reason: 'hidden', at: '2026-11-12T00:00:00.000Z' });
  assert.equal(amqp.channel.published.length, 1);
  assert.equal(amqp.channel.published[0].key, 'tour.unpublished');
});

test('close() stops the reconnect loop and forgets the consumers', async () => {
  const amqp = fakeAmqp();
  await rabbit.connect('amqp://x', opts(amqp));
  await rabbit.consume('q', ['a'], () => {});
  amqp.up = false;
  amqp.conn.drop();
  await rabbit.close();
  const attempts = amqp.attempts;
  amqp.up = true;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(amqp.attempts, attempts);
  assert.equal(rabbit.isReady(), false);

  // A later connect() starts clean: no consumer from before is replayed.
  await rabbit.connect('amqp://x', opts(amqp));
  amqp.conn.drop();
  await waitFor(() => rabbit.isReady());
  assert.equal(amqp.channel.consumers.length, 0);
});

test('close() on a healthy connection does not reconnect', async () => {
  const amqp = fakeAmqp();
  await rabbit.connect('amqp://x', opts(amqp));
  await rabbit.close();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(amqp.connections.length, 1);
  assert.equal(rabbit.isReady(), false);
});

// stopConsuming() is one-way (no connect or consume afterwards): each test gets its own module.
let instance = 0;
const freshRabbit = () => import(`../rabbitmq/index.js?drain=${(instance += 1)}`);
const unpublished = { tourId: 't1', reason: 'hidden', at: '2026-11-12T00:00:00.000Z' };

test('stopConsuming(): cancels every consumer and waits for the handlers in flight', async () => {
  const r = await freshRabbit();
  const amqp = fakeAmqp();
  await r.connect('amqp://x', opts(amqp));
  let release;
  await r.consume('a', ['x'], () => new Promise((res) => { release = res; }));
  await r.consume('b', ['y'], () => {});
  const ch = amqp.channel;
  const delivered = ch.deliver('a', 'x', {});

  let stopped = false;
  const stop = r.stopConsuming({ timeoutMs: 1000 }).then((v) => { stopped = true; return v; });
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(stopped, false, 'waits for the handler');
  assert.deepEqual(ch.cancelled, ['ctag-1', 'ctag-2']);
  assert.equal(r.isReady(), false, 'readiness goes down at once');

  // The handler in flight can still publish its result on the open channel.
  await r.publish('tour.unpublished', unpublished);
  assert.equal(ch.published.length, 1);
  release();
  assert.deepEqual(await stop, { pending: 0 });
  await delivered;
  assert.equal(ch.acked.length, 1);
  await r.close();
});

test('stopConsuming(): returns at once when nothing is in flight', async () => {
  const r = await freshRabbit();
  const amqp = fakeAmqp();
  await r.connect('amqp://x', opts(amqp));
  await r.consume('a', ['x'], () => {});
  await amqp.channel.deliver('a', 'x', {});
  const t0 = Date.now();
  assert.deepEqual(await r.stopConsuming({ timeoutMs: 1000 }), { pending: 0 });
  assert.ok(Date.now() - t0 < 100);
  await r.close();
});

test('stopConsuming(): gives up after timeoutMs; the unacked message is left to the broker', async () => {
  const r = await freshRabbit();
  const amqp = fakeAmqp();
  await r.connect('amqp://x', opts(amqp));
  await r.consume('a', ['x'], () => new Promise(() => {})); // never ends
  const ch = amqp.channel;
  ch.deliver('a', 'x', {});
  assert.deepEqual(await r.stopConsuming({ timeoutMs: 20 }), { pending: 1 });
  await r.close();
  assert.equal(ch.closed, true);
  assert.equal(ch.acked.length + ch.nacked.length, 0);
});

test('after stopConsuming(): no reconnect, connect() and consume() refuse', async () => {
  const r = await freshRabbit();
  const amqp = fakeAmqp();
  await r.connect('amqp://x', opts(amqp));
  await r.consume('a', ['x'], () => {});
  await r.stopConsuming({ timeoutMs: 20 });
  amqp.conn.drop();
  await new Promise((res) => setTimeout(res, 40));
  assert.equal(amqp.connections.length, 1);
  assert.equal(r.isReady(), false);
  await assert.rejects(r.consume('b', ['y'], () => {}), /shutting down/);
  await assert.rejects(r.connect('amqp://x', opts(amqp)), /shutting down/);
  assert.equal(amqp.connections.length, 1);
  await r.close();
});
