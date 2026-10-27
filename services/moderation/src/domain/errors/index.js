// Errors that drive retry decisions (task #AI-27).
export class AiTemporaryError extends Error {
  constructor(message, { status } = {}) { super(message); this.name = 'AiTemporaryError'; this.status = status; }
}
export class AiPermanentError extends Error {
  constructor(message, { status } = {}) { super(message); this.name = 'AiPermanentError'; this.status = status; }
}

// A case status change that the state machine forbids (task #AI-33).
export class InvalidTransitionError extends Error {
  constructor(from, to) { super(`invalid case transition: ${from} -> ${to}`); this.name = 'InvalidTransitionError'; this.from = from; this.to = to; }
}
