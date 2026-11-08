// =========================================================
// useChat — state of one chat view (floating panel or /chat page).
//   - Loads the stored session (localStorage) with GET /api/chat/history.
//   - send(): optimistic user message + streamed assistant message (token by token).
//   - stop(): aborts the stream (the partial answer stays, marked "Đã dừng").
//   - reset(): "Cuộc trò chuyện mới" (forgets the session id).
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatError,
  OFFLINE_MESSAGE,
  clearChatSession,
  fetchChatHistory,
  getChatSession,
  markChatDisabled,
  probeChat,
  setChatSession,
  streamChat,
  streamErrorMessage,
} from '../../lib/chat.js';

let seq = 0;
const nextId = () => `m${++seq}`;

const fromHistory = (m) => ({
  id: nextId(),
  role: m.role === 'assistant' ? 'assistant' : 'user',
  content: m.content || '',
  citations: Array.isArray(m.citations) ? m.citations : [],
  at: m.at,
});

/**
 * @param {{ onDisabled?: () => void }} [opts]
 * status: 'loading' | 'ready' | 'disabled' | 'error' (history could not be loaded)
 */
export default function useChat({ onDisabled } = {}) {
  const [status, setStatus] = useState('loading');
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null); // { message, kind, retryText? }
  const abortRef = useRef(null);
  const loadRef = useRef(null);
  const onDisabledRef = useRef(onDisabled);
  onDisabledRef.current = onDisabled;

  const disable = useCallback(() => {
    markChatDisabled();
    setStatus('disabled');
    onDisabledRef.current?.();
  }, []);

  const load = useCallback(async () => {
    loadRef.current?.abort();
    const ctrl = new AbortController();
    loadRef.current = ctrl;
    setError(null);
    const sessionId = getChatSession();
    if (!sessionId) {
      // No conversation to load: still ask once per page load whether the chatbot is on.
      const on = await probeChat();
      if (ctrl.signal.aborted) return;
      if (on === false) return disable();
      setMessages([]);
      setStatus('ready');
      return;
    }
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const { enabled, messages: list } = await fetchChatHistory(sessionId, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (!enabled) return disable();
      if (list === null) clearChatSession(); // expired or unknown session: start fresh
      setMessages((list || []).map(fromHistory));
      setStatus('ready');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setError({ message: e?.kind === 'offline' ? OFFLINE_MESSAGE : e.message, kind: 'history' });
      setStatus('error');
    }
  }, [disable]);

  useEffect(() => {
    load();
    return () => {
      loadRef.current?.abort();
      abortRef.current?.abort();
    };
  }, [load]);

  const patch = (id, fn) => setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)));

  const send = useCallback(
    async (raw) => {
      const text = (raw || '').trim();
      if (!text || abortRef.current) return false;
      loadRef.current?.abort(); // a late history response must not overwrite this turn
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const userId = nextId();
      const botId = nextId();
      setError(null);
      setSending(true);
      setStatus('ready');
      setMessages((list) => [
        ...list,
        { id: userId, role: 'user', content: text, citations: [] },
        { id: botId, role: 'assistant', content: '', citations: [], streaming: true },
      ]);
      let gotEvent = false;
      try {
        await streamChat({
          message: text,
          sessionId: getChatSession(),
          signal: ctrl.signal,
          onEvent: (name, data) => {
            gotEvent = true;
            if (name === 'meta' && data?.session_id) setChatSession(data.session_id);
            else if (name === 'token') patch(botId, (m) => ({ content: m.content + (data?.text ?? '') }));
            else if (name === 'citations') patch(botId, () => ({ citations: Array.isArray(data?.items) ? data.items : [] }));
            else if (name === 'done') patch(botId, () => ({ streaming: false, finishReason: data?.finish_reason }));
            else if (name === 'error') patch(botId, () => ({ streaming: false, error: streamErrorMessage(data) }));
          },
        });
        // Stream closed without `done` or `error`: keep what arrived.
        patch(botId, (m) =>
          m.streaming
            ? { streaming: false, error: m.content ? null : 'Trợ lý chưa trả lời, vui lòng thử lại.' }
            : {},
        );
      } catch (e) {
        if (e?.name === 'AbortError') {
          patch(botId, () => ({ streaming: false, stopped: true }));
        } else {
          const err = e instanceof ChatError ? e : new ChatError(OFFLINE_MESSAGE, { kind: 'offline' });
          if (err.kind === 'offline' && gotEvent) {
            patch(botId, (m) => ({ streaming: false, error: m.content ? 'Mất kết nối, câu trả lời chưa đầy đủ.' : OFFLINE_MESSAGE }));
          } else {
            // Nothing streamed: drop the empty answer, mark the question as not sent.
            setMessages((list) =>
              list.filter((m) => m.id !== botId).map((m) => (m.id === userId ? { ...m, failed: true } : m)),
            );
            if (err.kind === 'disabled') disable();
            else setError({ message: err.message, kind: err.kind, retryText: text, failedId: userId });
          }
        }
      } finally {
        abortRef.current = null;
        setSending(false);
      }
      return true;
    },
    [disable],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Resend the question that failed before streaming (offline, 429, 503). */
  const retry = useCallback(() => {
    if (!error?.retryText) return;
    const { retryText, failedId } = error;
    setMessages((list) => list.filter((m) => m.id !== failedId));
    send(retryText);
  }, [error, send]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    loadRef.current?.abort();
    clearChatSession();
    setMessages([]);
    setError(null);
    setStatus('ready');
  }, []);

  return { status, messages, sending, error, send, stop, retry, reset, reload: load, dismissError: () => setError(null) };
}
