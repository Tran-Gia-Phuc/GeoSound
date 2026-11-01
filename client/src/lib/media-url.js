// =========================================================
// #263 — Media stores file URLs with its configured base (default
// http://localhost:8080/api/media/files/...). A phone (LAN IP or ngrok) cannot reach the PC's
// localhost, so images and recorded audio failed there. URLs that point at a local gateway are
// rewritten to the API base the page already uses ('' = same origin through the Vite proxy).
// =========================================================

const LOCAL_API = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?=\/api\/)/i;

/** One URL: local-gateway URLs -> `${apiBase}/api/...`; anything else unchanged. */
export function localizeUrl(value, apiBase = '') {
  return typeof value === 'string' ? value.replace(LOCAL_API, apiBase) : value;
}

/** Deep copy of an API response with every local-gateway URL rewritten. */
export function localizeUrls(value, apiBase = '') {
  if (typeof value === 'string') return localizeUrl(value, apiBase);
  if (Array.isArray(value)) return value.map((v) => localizeUrls(v, apiBase));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = localizeUrls(v, apiBase);
    return out;
  }
  return value;
}
