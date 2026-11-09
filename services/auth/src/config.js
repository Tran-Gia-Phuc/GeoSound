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
    // #265 — "online" = active session seen within this window; heartbeats write at most this often.
    onlineWindowSeconds: num(env.AUTH_ONLINE_WINDOW_SECONDS, 120),
    heartbeatMinSeconds: num(env.AUTH_HEARTBEAT_MIN_SECONDS, 30),
  };
}

/** #329 presence of every visitor (Redis): cap of the online set and the local day for daily counts. */
export function presencePolicy(env = process.env) {
  const int = (v, d) => (v !== undefined && v !== '' && Number.isInteger(Number(v)) ? Number(v) : d);
  const maxDevices = int(env.AUTH_PRESENCE_MAX_DEVICES, 10000);
  return {
    maxDevices: maxDevices > 0 ? maxDevices : 10000,
    // Minutes added to UTC to get the local day of "today" (420 = Vietnam, UTC+7).
    dayOffsetMinutes: int(env.AUTH_PRESENCE_DAY_OFFSET_MINUTES, 420),
  };
}
