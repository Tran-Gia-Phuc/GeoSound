// Errors that drive retry decisions (task #AI-27).
export class AiTemporaryError extends Error {
  constructor(message, { status } = {}) { super(message); this.name = 'AiTemporaryError'; this.status = status; }
}
export class AiPermanentError extends Error {
  constructor(message, { status } = {}) { super(message); this.name = 'AiPermanentError'; this.status = status; }
}
