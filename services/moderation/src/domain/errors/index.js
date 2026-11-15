// Errors that drive retry decisions (task #AI-34).
// AiTemporaryError: the call may succeed later. kind = 'timeout' | 'network' | 'rate_limit' | 'server'
//   | 'malformed' | 'config' (401: configuration error, not retried inside one call; the sweeper retries).
// AiPermanentError: the request itself is wrong, never retried. kind = 'invalid_input' (422) | 'client' (other 4xx).
export class AiTemporaryError extends Error {
  constructor(message, { status, kind = 'server' } = {}) { super(message); this.name = 'AiTemporaryError'; this.status = status; this.kind = kind; }
}
export class AiPermanentError extends Error {
  constructor(message, { status, kind = 'client' } = {}) { super(message); this.name = 'AiPermanentError'; this.status = status; this.kind = kind; }
}

// A case status change that the state machine forbids (task #AI-33).
export class InvalidTransitionError extends Error {
  constructor(from, to) { super(`invalid case transition: ${from} -> ${to}`); this.name = 'InvalidTransitionError'; this.from = from; this.to = to; }
}
