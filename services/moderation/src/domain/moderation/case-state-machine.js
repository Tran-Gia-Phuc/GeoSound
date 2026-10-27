// Pure state machine for a case (task #AI-26). No I/O.
// pending -> completed (verdict stored) | ai_failed ; ai_failed -> pending (sweeper retry)
export const STATUS = Object.freeze({ PENDING: 'pending', COMPLETED: 'completed', AI_FAILED: 'ai_failed' });

export function canTransition(from, to) {
  throw new Error('not implemented: #AI-26');
}
export function transition(moderationCase, to, patch = {}) {
  throw new Error('not implemented: #AI-26');
}
