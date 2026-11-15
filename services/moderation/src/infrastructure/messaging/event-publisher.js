// Implements the EventPublisher port on top of shared/rabbitmq publish() (task #AI-36).
// Validates the payload against the shared zod contract before sending, so an invalid result never leaves
// Moderation. `at` must end with Z (z.string().datetime()): it is added with toISOString() when missing.
// `publish` and `validate` (shared validateEvent) are injected by index.js -> container.js: this module
// does not import shared/, so it also loads in the repo layout used by CI.

/** @implements {import('../../domain/ports/index.js').EventPublisher} */
export class EventPublisher {
  /**
   * @param {{ publish: (eventName: string, payload: object) => Promise<void>,
   *           validate: (eventName: string, payload: object) => object }} deps
   */
  constructor({ publish, validate }) {
    if (typeof publish !== 'function') throw new TypeError('EventPublisher needs a publish function');
    if (typeof validate !== 'function') throw new TypeError('EventPublisher needs a validate function');
    this.publishFn = publish;
    this.validate = validate;
  }

  async publish(eventName, payload) {
    const withAt = payload?.at ? payload : { ...payload, at: new Date().toISOString() };
    const valid = this.validate(eventName, withAt); // throws on a contract violation
    await this.publishFn(eventName, valid);
  }
}
