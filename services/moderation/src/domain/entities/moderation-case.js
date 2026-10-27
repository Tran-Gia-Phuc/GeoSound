// A moderation case = one (subjectType, subjectId, revision). Task #AI-33.
export const SUBJECT = Object.freeze({ PLACE: 'place', TOUR: 'tour' });
export const VERDICT = Object.freeze({ PASS: 'Pass', WARNING: 'Warning', REJECT: 'Reject' });
export const CASE_STATUS = Object.freeze({
  PENDING: 'pending',
  REVIEWING: 'reviewing',
  DONE: 'done',
  AI_FAILED: 'ai_failed',
  FAILED_PERMANENT: 'failed_permanent',
});
