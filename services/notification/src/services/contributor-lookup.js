// =========================================================
// #258 — Tour events carry contributorId but no contributorEmail: ask Auth for the email
// (GET /internal/users/:id/contact, header x-internal-token). Best effort: any failure returns
// null and is logged by the caller, the worker never crashes on it.
// =========================================================

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * @param {{ baseUrl?: string, token?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} opts
 * @returns {((userId: string) => Promise<string|null>) | null} null when not configured
 */
export function createContributorLookup({ baseUrl, token, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  const secret = String(token ?? '').trim();
  if (!base || !secret) return null;

  return async function lookupEmail(userId) {
    const res = await fetchImpl(`${base}/internal/users/${encodeURIComponent(userId)}/contact`, {
      headers: { 'x-internal-token': secret, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`auth answered ${res.status}`);
    const body = await res.json();
    return typeof body?.email === 'string' && body.email ? body.email : null;
  };
}

/** Lookup from the environment (AUTH_SERVICE_URL, INTERNAL_SERVICE_TOKEN). */
export function contributorLookupFromEnv(env = process.env) {
  return createContributorLookup({ baseUrl: env.AUTH_SERVICE_URL, token: env.INTERNAL_SERVICE_TOKEN });
}
