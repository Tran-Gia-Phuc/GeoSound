// Test helper: loads the shared event contract (zod) without a static ../shared import.
// The contract lives at <repo>/shared in the repo layout (CI) and at /app/shared in the Docker
// image, so it is loaded dynamically from whichever exists (same as services/moderation tests).
import { fileURLToPath } from 'node:url';

async function loadSharedEvents() {
  const candidates = ['../../../../shared/events/index.js', '../../shared/events/index.js'];
  let lastErr;
  for (const rel of candidates) {
    const url = new URL(rel, import.meta.url);
    try {
      return await import(url.href);
    } catch (err) {
      // Skip only when this candidate file is missing; any other error fails loudly.
      const missing = err?.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes(`'${fileURLToPath(url)}'`);
      if (!missing) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

export const { validateEvent, EVENTS } = await loadSharedEvents();
