// In-memory fakes. Tests never touch the network or a real database.
// The shared contract lives at <repo>/shared in the repo layout (CI) and at /app/shared in the Docker
// image, so it is loaded dynamically from whichever exists.
import { fileURLToPath } from 'node:url';

async function loadSharedEvents() {
  const candidates = ['../../../../shared/events/index.js', '../../shared/events/index.js'];
  let lastErr;
  for (const rel of candidates) {
    const url = new URL(rel, import.meta.url);
    try {
      return await import(url.href);
    } catch (err) {
      // Skip only when this candidate file is missing; any other error (e.g. zod not found) fails loudly.
      const missing = err?.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes(`'${fileURLToPath(url)}'`);
      if (!missing) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}
export const { validateEvent, EVENTS } = await loadSharedEvents();

export class FakeClock {
  constructor(start = new Date('2026-01-01T00:00:00.000Z')) { this.t = start.getTime(); }
  now() { return new Date(this.t); }
  advance(ms) { this.t += ms; }
}
// Validates every event with the shared zod contract, like the real EventPublisher.
// Set `failNext` to make the next publish throw (broker down).
export class FakePublisher {
  constructor() { this.events = []; this.failNext = 0; }
  async publish(eventName, payload) {
    if (this.failNext > 0) { this.failNext -= 1; throw new Error('broker down'); }
    this.events.push({ eventName, payload: validateEvent(eventName, payload) });
  }
}
export class FakeAiReviewer {
  constructor(responder) { this.responder = responder; this.calls = []; }
  async reviewPlace(p) { this.calls.push(['place', p]); return this.responder(p); }
  async reviewTour(t) { this.calls.push(['tour', t]); return this.responder(t); }
}
// Logger that records lines instead of printing them.
export class FakeLogger {
  constructor() { this.lines = []; }
  info(m) { this.lines.push(['info', m]); }
  warn(m) { this.lines.push(['warn', m]); }
  error(m) { this.lines.push(['error', m]); }
}
