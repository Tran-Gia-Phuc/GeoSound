// Case state machine (task #AI-33): every allowed and forbidden transition, immutability, attempts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, transition, isTerminal, STATUS } from '../src/domain/moderation/case-state-machine.js';
import { CASE_STATUS } from '../src/domain/entities/moderation-case.js';
import { InvalidTransitionError } from '../src/domain/errors/index.js';

const S = CASE_STATUS;
const ALL = Object.values(S);
const ALLOWED = new Set([
  `${S.PENDING}>${S.REVIEWING}`,
  `${S.REVIEWING}>${S.DONE}`,
  `${S.REVIEWING}>${S.AI_FAILED}`,
  `${S.REVIEWING}>${S.FAILED_PERMANENT}`,
  `${S.AI_FAILED}>${S.REVIEWING}`,
]);

for (const from of ALL) {
  for (const to of ALL) {
    const ok = ALLOWED.has(`${from}>${to}`);
    test(`${from} -> ${to} is ${ok ? 'allowed' : 'forbidden'}`, () => {
      assert.equal(canTransition(from, to), ok);
      const c = { id: 'c1', status: from, attempts: 1 };
      if (ok) {
        assert.equal(transition(c, to).status, to);
      } else {
        assert.throws(() => transition(c, to), (err) => err instanceof InvalidTransitionError
          && err.from === from && err.to === to);
      }
    });
  }
}

test('unknown statuses are forbidden', () => {
  assert.equal(canTransition('completed', S.REVIEWING), false);
  assert.equal(canTransition(S.PENDING, 'completed'), false);
  assert.equal(canTransition('toString', S.REVIEWING), false);
  assert.throws(() => transition(null, S.REVIEWING), InvalidTransitionError);
  assert.throws(() => transition({ status: 'nope' }, S.DONE), InvalidTransitionError);
});

test('done and failed_permanent are terminal', () => {
  assert.equal(isTerminal(S.DONE), true);
  assert.equal(isTerminal(S.FAILED_PERMANENT), true);
  for (const s of [S.PENDING, S.REVIEWING, S.AI_FAILED]) assert.equal(isTerminal(s), false);
});

test('transition returns a new object and never mutates the input', () => {
  const c = Object.freeze({ id: 'c1', status: S.REVIEWING, attempts: 1, verdict: null });
  const next = transition(c, S.DONE, { verdict: 'Pass', severity: 0.1 });
  assert.notEqual(next, c);
  assert.deepEqual(next, { id: 'c1', status: S.DONE, attempts: 1, verdict: 'Pass', severity: 0.1 });
  assert.deepEqual(c, { id: 'c1', status: S.REVIEWING, attempts: 1, verdict: null });
});

test('patch cannot override the target status', () => {
  const next = transition({ status: S.REVIEWING, attempts: 1 }, S.AI_FAILED, { status: S.DONE, lastError: 'x' });
  assert.equal(next.status, S.AI_FAILED);
  assert.equal(next.lastError, 'x');
});

test('entering reviewing increments attempts; other transitions keep it', () => {
  let c = { status: S.PENDING, attempts: 0 };
  c = transition(c, S.REVIEWING);
  assert.equal(c.attempts, 1);
  c = transition(c, S.AI_FAILED);
  assert.equal(c.attempts, 1);
  c = transition(c, S.REVIEWING);
  assert.equal(c.attempts, 2);
  c = transition(c, S.DONE);
  assert.equal(c.attempts, 2);
});

test('missing attempts counts from 0, and patch.attempts is overridden on reviewing', () => {
  assert.equal(transition({ status: S.PENDING }, S.REVIEWING).attempts, 1);
  assert.equal(transition({ status: S.AI_FAILED, attempts: 2 }, S.REVIEWING, { attempts: 99 }).attempts, 3);
});

test('STATUS is kept as an alias of CASE_STATUS', () => {
  assert.equal(STATUS, CASE_STATUS);
});
