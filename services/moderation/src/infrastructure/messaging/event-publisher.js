// Publishes result events through shared/rabbitmq publish() (zod-validated). Task #AI-28.
// `at` must end with Z (z.string().datetime()): use new Date().toISOString().
export class EventPublisher {
  constructor(publishFn) { this.publishFn = publishFn; }
  async publish(eventName, payload) { throw new Error('not implemented: #AI-28'); }
}
