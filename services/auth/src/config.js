// =========================================================
// Auth config helpers without side effects (no Prisma/Redis import), so tests can load them.
// =========================================================

/** UC23 session policy from env (docs/02-design/device-sessions.md R8, R9, R12). */
export function sessionPolicy(env = process.env) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    idleDays: num(env.AUTH_SESSION_IDLE_DAYS, 7),
    maxDays: num(env.AUTH_SESSION_MAX_DAYS, 30),
    maxSessions: num(env.AUTH_MAX_SESSIONS, 100),
    retentionDays: num(env.AUTH_SESSION_RETENTION_DAYS, 30),
  };
}
