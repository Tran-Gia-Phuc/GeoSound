// =========================================================
// Chatbot over the gateway (issue #188, AI service /chat).
//   POST /api/chat          body { message, session_id? } -> text/event-stream
//        events, in order: meta {session_id, lang}, token {text} (0..n),
//        citations {items: [{kind, id, title}]}, done {finish_reason, llm_calls};
//        `error` {code, message} replaces the rest when the stream fails.
//   GET  /api/chat/history?session_id= -> { session_id, messages: [{role, content, citations?, at}] }
// Errors before the stream are plain JSON: 404 (chatbot off, or unknown session on
// history), 422 (invalid message), 429 (+ Retry-After, gateway or AI), 503.
// Answer text keeps the `[tour:ID]` / `[place:ID]` markers; the UI turns them into links.
// =========================================================
import { api } from './api.js';

/** Backend default CHAT_MESSAGE_MAX_CHARS (not exposed by the API). */
export const MAX_MESSAGE_CHARS = 1000;

export const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
export const DISABLED_MESSAGE = 'Chatbot đang tắt';

const SESSION_KEY = 'geosound:chat-session';
const NIL_SESSION = '00000000-0000-0000-0000-000000000000';
const UNKNOWN_SESSION = 'unknown session';

// ---------- session (per browser) ----------

export function getChatSession() {
  try {
    return localStorage.getItem(SESSION_KEY) || null;
  } catch {
    return null;
  }
}

export function setChatSession(id) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* storage blocked: the session lasts for this page only */
  }
}

export function clearChatSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- errors ----------

export class ChatError extends Error {
  /** kind: offline | disabled | rate_limited | invalid | unavailable | stream */
  constructor(message, { kind, status, retryAfter } = {}) {
    super(message);
    this.name = 'ChatError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** 45 -> "45 giây", 300 -> "5 phút", 7200 -> "2 giờ". */
export function formatWait(seconds) {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} giây`;
  if (s < 3600) return `${Math.ceil(s / 60)} phút`;
  return `${Math.ceil(s / 3600)} giờ`;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** A 404 from the chat routes means "chatbot off" unless it is the AI's "unknown session". */
const isUnknownSession = (body) => body?.detail === UNKNOWN_SESSION;

/** Map an HTTP error response of POST /api/chat to a Vietnamese ChatError. */
export async function errorFromResponse(res) {
  const body = await readJson(res);
  const status = res.status;
  if (status === 404) return new ChatError(DISABLED_MESSAGE, { kind: 'disabled', status });
  if (status === 429) {
    const retryAfter = Number.parseInt(res.headers.get('Retry-After') || '', 10);
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
    // Gateway limit -> { error }, AI busy -> { detail }.
    const head = body?.detail ? 'Trợ lý đang bận' : 'Bạn đã hỏi quá nhiều trong thời gian ngắn';
    const tail = wait ? `, vui lòng thử lại sau ${formatWait(wait)}.` : ', vui lòng thử lại sau.';
    return new ChatError(head + tail, { kind: 'rate_limited', status, retryAfter: wait });
  }
  if (status === 422) {
    return new ChatError(`Câu hỏi không hợp lệ. Vui lòng nhập từ 1 đến ${MAX_MESSAGE_CHARS} ký tự.`, {
      kind: 'invalid',
      status,
    });
  }
  return new ChatError('Trợ lý tạm thời không phản hồi, vui lòng thử lại sau.', { kind: 'unavailable', status });
}

/** Message shown for an SSE `error` event (the backend message is English). */
export function streamErrorMessage(data) {
  if (data?.code === 'internal' || !data?.message) return 'Trợ lý gặp lỗi khi trả lời, vui lòng thử lại.';
  return /[À-ỹ]/.test(data.message) ? data.message : 'Trợ lý gặp lỗi khi trả lời, vui lòng thử lại.';
}

// ---------- Server-Sent Events ----------

/**
 * Incremental SSE parser: feed decoded text chunks, get complete events back.
 * Handles CRLF, multi-line `data:`, comments (`:`) and events split across chunks.
 */
export function createSseParser() {
  let buffer = '';
  const parseBlock = (block) => {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      let value = i < 0 ? '' : line.slice(i + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (!data.length) return null;
    let parsed;
    try {
      parsed = JSON.parse(data.join('\n'));
    } catch {
      parsed = { text: data.join('\n') };
    }
    return { event, data: parsed };
  };
  return {
    /** @param {string} chunk @returns {{event: string, data: any}[]} */
    feed(chunk) {
      buffer += chunk.replace(/\r\n?/g, '\n');
      const out = [];
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const ev = parseBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (ev) out.push(ev);
      }
      return out;
    },
    /** Remaining complete-looking block at end of stream. */
    flush() {
      const ev = buffer.trim() ? parseBlock(buffer) : null;
      buffer = '';
      return ev ? [ev] : [];
    },
  };
}

// Questions about the user's own position ("gần tôi", "quanh đây", "near me").
const ASKS_HERE = /(gần|quanh|xung quanh|cạnh|kế bên)\s+(tôi|mình|đây|em|chỗ (tôi|mình|này))|quanh đây|gần nhất|near me|nearby|around here|close to me/i;

/** True when the question needs the user's position (UC24). */
export function asksForLocation(message) {
  return ASKS_HERE.test(message || '');
}

function readPosition(timeout) {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout, maximumAge: 300000 },
    );
  });
}

/**
 * Position to send with a chat question, or null. When the browser already allows
 * location it is always sent (no prompt); otherwise the browser is asked only for a
 * "near me" question. Denied, unsupported or slow (6 s) -> null: the question is sent
 * without it and the assistant answers from the text.
 */
export async function locationFor(message) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  let granted = false;
  try {
    granted = (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'granted';
  } catch {
    /* Permissions API missing: decide from the question */
  }
  if (!granted && !asksForLocation(message)) return null;
  return readPosition(6000);
}

/**
 * POST /api/chat and stream the answer. `onEvent(name, data)` is called for every
 * SSE event (meta, token, citations, done, error). Resolves when the stream ends.
 * Throws ChatError for HTTP errors and network failures, AbortError when aborted.
 * `location` {lat, lng} (optional) lets the assistant answer "near me" questions.
 * @param {{ message: string, sessionId?: string|null, signal?: AbortSignal,
 *           location?: {lat: number, lng: number}|null,
 *           onEvent: (name: string, data: any) => void }} opts
 */
export async function streamChat({ message, sessionId, signal, location, onEvent }) {
  const body = { message };
  if (location) body.location = { lat: location.lat, lng: location.lng };
  if (sessionId) body.session_id = sessionId;
  let res;
  try {
    res = await api.stream('POST', '/api/chat', { body, signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ChatError(OFFLINE_MESSAGE, { kind: 'offline' });
  }
  if (!res.ok) throw await errorFromResponse(res);

  const parser = createSseParser();
  const emit = (events) => events.forEach((ev) => onEvent(ev.event, ev.data));
  if (!res.body?.getReader) {
    // No streaming support: read everything at once.
    emit(parser.feed(await res.text()));
    emit(parser.flush());
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      emit(parser.feed(decoder.decode(value, { stream: true })));
    }
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted) {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      throw abort;
    }
    throw new ChatError(OFFLINE_MESSAGE, { kind: 'offline' });
  }
  emit(parser.feed(decoder.decode()));
  emit(parser.flush());
}

/**
 * GET /api/chat/history for a stored session.
 * @returns {Promise<{ enabled: boolean, messages: Array|null }>}
 *   messages null = unknown / expired session (the caller clears it).
 */
export async function fetchChatHistory(sessionId, { signal } = {}) {
  let res;
  try {
    res = await api.stream('GET', `/api/chat/history?session_id=${encodeURIComponent(sessionId)}`, {
      signal,
      accept: 'application/json',
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ChatError(OFFLINE_MESSAGE, { kind: 'offline' });
  }
  const body = await readJson(res);
  if (res.ok) return { enabled: true, messages: Array.isArray(body?.messages) ? body.messages : [] };
  if (res.status === 404) return { enabled: isUnknownSession(body), messages: null };
  if (res.status === 422) return { enabled: true, messages: null }; // malformed stored id
  throw new ChatError('Chưa tải được cuộc trò chuyện', { kind: 'unavailable', status: res.status });
}

let probe = null;

/**
 * Is the chatbot on? One request per page load: history of the stored session, or of the
 * nil session (404 "unknown session" = on, any other 404 = off). Network or server
 * errors give `null` (unknown): the button stays visible and the panel shows the error.
 * @returns {Promise<boolean|null>}
 */
export function probeChat() {
  if (!probe) {
    probe = fetchChatHistory(getChatSession() || NIL_SESSION)
      .then((r) => r.enabled)
      .catch(() => {
        probe = null; // try again next time
        return null;
      });
  }
  return probe;
}

/** Mark the chatbot as off for the rest of this page load (a later 404 on POST). */
export function markChatDisabled() {
  probe = Promise.resolve(false);
}

// ---------- citation markers ----------

const MARKER = /\[(tour|place):([^[\]\s]{1,100})\]/g;

/**
 * Split answer text into parts: { type: 'text', text } and { type: 'cite', kind, id }.
 * A trailing unfinished marker ("[tour:ab") is hidden while streaming.
 */
export function splitMarkers(text, { streaming = false } = {}) {
  let src = text || '';
  if (streaming) src = src.replace(/\[(?:(?:tour|place):[^[\]\s]{0,100}|[a-z]{0,5})$/, '');
  const parts = [];
  let last = 0;
  for (const m of src.matchAll(MARKER)) {
    if (m.index > last) parts.push({ type: 'text', text: src.slice(last, m.index) });
    parts.push({ type: 'cite', kind: m[1], id: m[2] });
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ type: 'text', text: src.slice(last) });
  return parts;
}

/** Link target of a citation: tour -> /tour/:id; place -> its tour page when known, else null. */
export function citationHref(item) {
  if (!item) return null;
  if (item.kind === 'tour') return `/tour/${encodeURIComponent(item.id)}`;
  const tourId = item.tour_id || item.tourId;
  return item.kind === 'place' && tourId ? `/tour/${encodeURIComponent(tourId)}` : null;
}
