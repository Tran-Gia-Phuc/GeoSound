// =========================================================
// Impl of the EventPublisher port. `publish` is the shared RabbitMQ helper injected by
// index.js (only index.js may import ../shared); it validates the payload against
// shared/events. Without a broker (publish = null) events are dropped with a log line.
// =========================================================

/** @implements {import('../../domain/ports/index.js').EventPublisher} */
export class EventPublisher {
  /** @param {{ publish?: ((name: string, payload: object) => Promise<void>)|null, logger?: Console }} deps */
  constructor({ publish = null, logger = console } = {}) {
    this.publishFn = publish;
    this.logger = logger;
  }

  async publish(eventName, payload) {
    if (!this.publishFn) {
      this.logger.log(`[auth] broker not configured, ${eventName} not sent`);
      return;
    }
    await this.publishFn(eventName, payload);
  }
}
