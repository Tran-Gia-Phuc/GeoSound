// HTTP adapter for the AI service (task #AI-27). Implements the AiReviewer port.
// Sends header x-internal-token. Truncates fields to the limits before calling (D9).
// 200 ok | 422 + other 4xx -> AiPermanentError | 503, 429, timeout, network -> AiTemporaryError.
export class HttpAiReviewer {
  /** @param {{ baseUrl: string, token: string, timeoutMs: number, fetchImpl?: typeof fetch }} opts */
  constructor({ baseUrl, token, timeoutMs, fetchImpl = globalThis.fetch }) {
    Object.assign(this, { baseUrl, token, timeoutMs, fetch: fetchImpl });
  }
  async reviewPlace(place) { throw new Error('not implemented: #AI-27'); }
  async reviewTour(tour) { throw new Error('not implemented: #AI-27'); }
}
