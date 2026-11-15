// Prometheus ModerationMetrics adapter (deployment task 4.4), built from fake counter / histogram / gauge factories
// with the frozen shared/metrics API. No prom-client, no shared import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPromModerationMetrics, CASE_DURATION_BUCKETS,
} from '../src/infrastructure/metrics/prom-moderation-metrics.js';
import { buildContainer } from '../src/container.js';
import { loadConfig } from '../src/config.js';
import { NOOP_MODERATION_METRICS } from '../src/domain/ports/index.js';
import { FakeClock, FakeLogger, validateEvent } from './helpers/fakes.js';

function fakeFactories() {
  const defs = {};
  const calls = [];
  const record = (name, op) => (labels, value) => calls.push([name, op, labels, value]);
  return {
    defs,
    calls,
    counter(def) { defs[def.name] = { type: 'counter', ...def }; return { inc: record(def.name, 'inc') }; },
    histogram(def) {
      defs[def.name] = { type: 'histogram', ...def };
      return { observe: record(def.name, 'observe'), startTimer: () => () => {} };
    },
    gauge(def) {
      defs[def.name] = { type: 'gauge', ...def };
      return { set: record(def.name, 'set'), inc: record(def.name, 'inc'), dec: record(def.name, 'dec') };
    },
  };
}

test('registers the four moderation metrics with their labels and buckets', () => {
  const f = fakeFactories();
  createPromModerationMetrics(f);
  assert.deepEqual(Object.keys(f.defs).sort(), [
    'moderation_ai_failed_total', 'moderation_case_duration_seconds', 'moderation_cases_total', 'moderation_pending_cases',
  ]);
  assert.deepEqual(f.defs.moderation_cases_total.labelNames, ['kind', 'verdict', 'source']);
  assert.deepEqual(f.defs.moderation_ai_failed_total.labelNames, ['kind', 'reason']);
  assert.deepEqual(f.defs.moderation_case_duration_seconds.labelNames, ['kind']);
  assert.deepEqual(f.defs.moderation_case_duration_seconds.buckets, [1, 5, 15, 30, 60, 120, 300, 900]);
  assert.deepEqual([...CASE_DURATION_BUCKETS], [1, 5, 15, 30, 60, 120, 300, 900]);
  assert.deepEqual(f.defs.moderation_pending_cases.labelNames, []);
  assert.equal(f.defs.moderation_pending_cases.type, 'gauge');
});

test('the cases_total help text states the source tie rule', () => {
  const f = fakeFactories();
  createPromModerationMetrics(f);
  const { help } = f.defs.moderation_cases_total;
  assert.match(help, /signal that set the final verdict/);
  assert.match(help, /same verdict, source is ai/);
});

test('caseFinished increments cases_total and observes the duration per kind', () => {
  const f = fakeFactories();
  const m = createPromModerationMetrics(f);
  m.caseFinished({ kind: 'tour', verdict: 'Warning', source: 'geo', seconds: 42 });
  assert.deepEqual(f.calls, [
    ['moderation_cases_total', 'inc', { kind: 'tour', verdict: 'Warning', source: 'geo' }, undefined],
    ['moderation_case_duration_seconds', 'observe', { kind: 'tour' }, 42],
  ]);
});

test('label values are clamped to closed sets; ids never become labels', () => {
  const f = fakeFactories();
  const m = createPromModerationMetrics(f);
  m.caseFinished({ kind: 'place-123', verdict: 'Maybe', source: 'user-9', seconds: 1, placeId: 'p1', tourId: 't1' });
  m.aiFailed({ kind: 'tour', reason: '500' });
  m.aiFailed({ kind: undefined, reason: 'timeout', contributorId: 'u1' });
  assert.deepEqual(f.calls, [
    ['moderation_cases_total', 'inc', { kind: 'other', verdict: 'Warning', source: 'ai' }, undefined],
    ['moderation_case_duration_seconds', 'observe', { kind: 'other' }, 1],
    ['moderation_ai_failed_total', 'inc', { kind: 'tour', reason: 'other' }, undefined],
    ['moderation_ai_failed_total', 'inc', { kind: 'other', reason: 'timeout' }, undefined],
  ]);
  for (const [, , labels] of f.calls) {
    assert.ok(!Object.values(labels).some((v) => ['p1', 't1', 'u1'].includes(v)));
  }
});

test('a missing or bad duration only skips the histogram; a bad pending count is ignored', () => {
  const f = fakeFactories();
  const m = createPromModerationMetrics(f);
  m.caseFinished({ kind: 'place', verdict: 'Pass', source: 'ai', seconds: null });
  m.caseFinished({ kind: 'place', verdict: 'Pass', source: 'ai', seconds: -1 });
  m.setPending(3);
  m.setPending(Number.NaN);
  m.setPending(-1);
  m.setPending(undefined);
  assert.deepEqual(f.calls.map(([name, op]) => `${name}.${op}`), [
    'moderation_cases_total.inc', 'moderation_cases_total.inc', 'moderation_pending_cases.set',
  ]);
  assert.deepEqual(f.calls[2].slice(2), [{}, 3]);
});

test('a throwing metric is logged, never thrown', () => {
  const logger = new FakeLogger();
  const boom = () => { throw new Error('bad label'); };
  const m = createPromModerationMetrics({
    counter: () => ({ inc: boom }), histogram: () => ({ observe: boom }), gauge: () => ({ set: boom }),
  }, { logger });
  assert.doesNotThrow(() => m.caseFinished({ kind: 'place', verdict: 'Pass', source: 'ai', seconds: 1 }));
  assert.doesNotThrow(() => m.aiFailed({ kind: 'place', reason: '503' }));
  assert.doesNotThrow(() => m.setPending(1));
  assert.equal(logger.lines.filter(([level]) => level === 'warn').length, 3);
});

test('container builds the prom port from the factories, and a no-op port without them', () => {
  const config = loadConfig({});
  const base = { prisma: {}, publish: async () => {}, validateEvent, config, clock: new FakeClock(), logger: new FakeLogger() };
  const f = fakeFactories();
  const c = buildContainer({ ...base, metricFactories: f });
  assert.ok(f.defs.moderation_cases_total);
  assert.notEqual(c.moderationMetrics, NOOP_MODERATION_METRICS);
  assert.equal(c.runPlaceReview.metrics, c.moderationMetrics);
  assert.equal(c.runTourReview.metrics, c.moderationMetrics);

  const d = buildContainer(base);
  assert.equal(d.moderationMetrics, NOOP_MODERATION_METRICS);
  assert.equal(d.runPlaceReview.metrics, NOOP_MODERATION_METRICS);
});
