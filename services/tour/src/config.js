// =========================================================
// Tour service flags read from the environment (no imports, safe to unit-test).
// =========================================================

// UC15 — AI moderation through events, OFF by default (false = direct publish as today).
export function isModerationEnabled(env = process.env) {
  return String(env.MODERATION_EVENTS_ENABLED ?? '').toLowerCase() === 'true';
}
