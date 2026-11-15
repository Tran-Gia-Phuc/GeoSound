// Merging moderation signals (task #AI-33): worst wins, max severity, reasons with source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeVerdicts } from '../src/domain/moderation/merge-verdicts.js';

const r = (verdict, severity, reasons = [], source) => ({ verdict, severity, reasons, ...(source && { source }) });
const reason = (field, category = 'misleading', extra = {}) => ({ field, category, message: `${field} issue`, ...extra });

test('empty or missing input is Pass with severity 0', () => {
  for (const input of [[], undefined, [null, undefined]]) {
    assert.deepEqual(mergeVerdicts(input), { verdict: 'Pass', severity: 0, reasons: [], warning: false });
  }
});

const combos = [
  [['Pass'], 'Pass'],
  [['Warning'], 'Warning'],
  [['Reject'], 'Reject'],
  [['Pass', 'Pass'], 'Pass'],
  [['Pass', 'Warning'], 'Warning'],
  [['Warning', 'Pass'], 'Warning'],
  [['Pass', 'Reject'], 'Reject'],
  [['Reject', 'Pass'], 'Reject'],
  [['Warning', 'Reject'], 'Reject'],
  [['Reject', 'Warning'], 'Reject'],
  [['Warning', 'Warning'], 'Warning'],
  [['Pass', 'Warning', 'Reject'], 'Reject'],
];
for (const [inputs, expected] of combos) {
  test(`worst wins: ${inputs.join(' + ')} -> ${expected}`, () => {
    const out = mergeVerdicts(inputs.map((v) => r(v, 0.1)));
    assert.equal(out.verdict, expected);
    assert.equal(out.warning, expected === 'Warning');
  });
}

test('severity is the max, independent of the verdict order', () => {
  assert.equal(mergeVerdicts([r('Reject', 0.85), r('Warning', 0.9), r('Pass', 0.2)]).severity, 0.9);
  assert.equal(mergeVerdicts([r('Pass', 0)]).severity, 0);
  assert.equal(mergeVerdicts([r('Pass', undefined), r('Warning', 0.4)]).severity, 0.4);
});

test('reasons are concatenated in input order and tagged with their source', () => {
  const ai = r('Warning', 0.5, [reason('description'), reason('title')], 'ai');
  const geo = r('Warning', 0.4, [reason('route', 'route')], 'geo');
  const out = mergeVerdicts([ai, geo]);
  assert.deepEqual(out.reasons.map((x) => [x.field, x.source]), [
    ['description', 'ai'], ['title', 'ai'], ['route', 'geo'],
  ]);
});

test('an existing reason source is kept; no source on the result leaves it absent', () => {
  const out = mergeVerdicts([
    r('Warning', 0.5, [reason('a', 'other', { source: 'geo' })], 'ai'),
    r('Pass', 0, [reason('b')]),
  ]);
  assert.equal(out.reasons[0].source, 'geo');
  assert.equal('source' in out.reasons[1], false);
});

test('null and undefined entries are ignored', () => {
  const out = mergeVerdicts([null, r('Warning', 0.6, [reason('x')], 'ai'), undefined]);
  assert.equal(out.verdict, 'Warning');
  assert.equal(out.severity, 0.6);
  assert.equal(out.reasons.length, 1);
});

test('an unknown verdict counts as Warning (doubt goes to a human)', () => {
  assert.equal(mergeVerdicts([r('Pass', 0), r('Maybe', 0.1)]).verdict, 'Warning');
  assert.equal(mergeVerdicts([r('Reject', 0.9), r('Maybe', 0.1)]).verdict, 'Reject');
});

test('inputs are not mutated and reasons are copies', () => {
  const rs = [reason('description')];
  const input = [r('Warning', 0.5, rs, 'ai')];
  const snapshot = structuredClone(input);
  const out = mergeVerdicts(input);
  assert.deepEqual(input, snapshot);
  assert.notEqual(out.reasons[0], rs[0]);
});
