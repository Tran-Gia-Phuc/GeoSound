// HTTP adapter for the AI service (task #AI-34). Implements the AiReviewer port.
// Input: the event payload (camelCase). ai-mapping converts it to the snake_case body and truncates it (D9).
// Sends header x-internal-token. Never logs the token or request/response bodies.
// 2xx -> parsed result | 422, other 4xx -> AiPermanentError (no retry)
// 401 -> AiTemporaryError kind 'config' (no retry in this call; the sweeper retries later)
// 429, 5xx, timeout, network, malformed body -> AiTemporaryError, retried 3 times (2 s, 4 s).
import { toPlaceRequest, toTourRequest, fromAiResponse } from '../../application/dtos/ai-mapping.js';
import { AiTemporaryError, AiPermanentError } from '../../domain/errors/index.js';
import { withRetry } from '../retry/with-retry.js';

export function classifyStatus(status) {
  if (status === 401) return new AiTemporaryError('AI service rejected the internal token (401)', { status, kind: 'config' });
  if (status === 429) return new AiTemporaryError('AI service rate limited (429)', { status, kind: 'rate_limit' });
  if (status === 422) return new AiPermanentError('AI service rejected the input (422)', { status, kind: 'invalid_input' });
  if (status >= 400 && status < 500) return new AiPermanentError(`AI service answered ${status}`, { status, kind: 'client' });
  return new AiTemporaryError(`AI service answered ${status}`, { status, kind: 'server' });
}

export class HttpAiReviewer {
  /**
   * @param {{ baseUrl: string, token: string, timeoutMs: number, maxAttempts?: number, retryDelayMs?: number,
   *           fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void> }} opts
   */
  constructor({ baseUrl, token, timeoutMs, maxAttempts = 3, retryDelayMs = 2000, fetchImpl = globalThis.fetch, sleep }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.retry = { maxAttempts, baseDelayMs: retryDelayMs, ...(sleep && { sleep }) };
    this.fetch = fetchImpl;
    // Not enumerable, so the token never shows up when the reviewer is logged or inspected.
    Object.defineProperty(this, 'token', { value: token, enumerable: false });
  }

  async reviewPlace(place) {
    return this.#post('/moderate/place', toPlaceRequest(place));
  }

  async reviewTour(tour) {
    const { imagesChecked, ...result } = await this.#post('/moderate/tour', toTourRequest(tour));
    return result;
  }

  #post(path, body) {
    const payload = JSON.stringify(body);
    return withRetry(() => this.#once(path, payload), this.retry);
  }

  async #once(path, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res;
      try {
        res = await this.fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-token': this.token },
          body: payload,
          redirect: 'error', // never forward the token to a redirect target
          signal: controller.signal,
        });
      } catch (err) {
        throw this.#transportError(err, controller);
      }
      if (res.status < 200 || res.status >= 300) {
        await res.body?.cancel().catch(() => {});
        throw classifyStatus(res.status);
      }
      let json;
      try {
        json = await res.json();
      } catch (err) {
        if (controller.signal.aborted) throw this.#transportError(err, controller);
        throw new AiTemporaryError('malformed AI response: invalid JSON', { status: res.status, kind: 'malformed' });
      }
      return fromAiResponse(json);
    } finally {
      clearTimeout(timer);
    }
  }

  #transportError(err, controller) {
    if (controller.signal.aborted) {
      return new AiTemporaryError(`AI service timed out after ${this.timeoutMs} ms`, { kind: 'timeout' });
    }
    return new AiTemporaryError(`AI service unreachable: ${err?.cause?.code ?? err?.name ?? 'network error'}`, { kind: 'network' });
  }
}
