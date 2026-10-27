// Pure state machine for a moderation case (task #AI-33). No I/O.
//
//   pending   -> reviewing                          (AI call starts)
//   reviewing -> done | ai_failed | failed_permanent
//   ai_failed -> reviewing                          (sweeper retry)
//   done, failed_permanent: terminal
//
// There is no pending -> ai_failed edge: a case always enters reviewing before the AI call, and a
// crash before that leaves it pending, which the sweeper picks up as a stale pending case.
// A stale reviewing case (crash during the call) is retried as reviewing -> ai_failed -> reviewing.
import { CASE_STATUS } from '../entities/moderation-case.js';
import { InvalidTransitionError } from '../errors/index.js';

export { CASE_STATUS };
// Kept for older imports; prefer CASE_STATUS.
export const STATUS = CASE_STATUS;

const ALLOWED = Object.freeze({
  [CASE_STATUS.PENDING]: Object.freeze([CASE_STATUS.REVIEWING]),
  [CASE_STATUS.REVIEWING]: Object.freeze([CASE_STATUS.DONE, CASE_STATUS.AI_FAILED, CASE_STATUS.FAILED_PERMANENT]),
  [CASE_STATUS.AI_FAILED]: Object.freeze([CASE_STATUS.REVIEWING]),
  [CASE_STATUS.DONE]: Object.freeze([]),
  [CASE_STATUS.FAILED_PERMANENT]: Object.freeze([]),
});

export function canTransition(from, to) {
  return Object.hasOwn(ALLOWED, from) && ALLOWED[from].includes(to);
}

export function isTerminal(status) {
  return Object.hasOwn(ALLOWED, status) && ALLOWED[status].length === 0;
}

// Returns a new case object; the input is never mutated. Entering reviewing counts one attempt.
export function transition(moderationCase, to, patch = {}) {
  const from = moderationCase?.status;
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
  const next = { ...moderationCase, ...patch, status: to };
  if (to === CASE_STATUS.REVIEWING) next.attempts = (moderationCase.attempts ?? 0) + 1;
  return next;
}
