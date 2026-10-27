// In-memory fakes. Tests never touch the network or a real database.
export class FakeClock {
  constructor(start = new Date('2026-01-01T00:00:00.000Z')) { this.t = start.getTime(); }
  now() { return new Date(this.t); }
  advance(ms) { this.t += ms; }
}
export class FakePublisher {
  constructor() { this.events = []; }
  async publish(eventName, payload) { this.events.push({ eventName, payload }); }
}
export class FakeAiReviewer {
  constructor(responder) { this.responder = responder; this.calls = []; }
  async reviewPlace(p) { this.calls.push(['place', p]); return this.responder(p); }
  async reviewTour(t) { this.calls.push(['tour', t]); return this.responder(t); }
}
