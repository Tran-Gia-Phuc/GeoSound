// =========================================================
// ChatView — the chatbot conversation, used by the floating panel (ChatLauncher)
// and by the /chat page.
//   - Empty state with suggestion chips; answers stream token by token.
//   - `[tour:ID]` / `[place:ID]` markers become numbered source links; a "Nguồn"
//     list follows each answer (from the `citations` event / history).
//   - States: loading history, typing indicator, stop, error (stream / HTTP),
//     429 with retry time, chatbot off, offline; message counter (max 1000).
// =========================================================
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { DISABLED_MESSAGE, MAX_MESSAGE_CHARS, citationHref, splitMarkers } from '../../lib/chat.js';
import useChat from './useChat.js';

export const SUGGESTIONS = [
  'Gợi ý tour đi bộ ở Hội An',
  'Quán ăn gần Phố cổ',
  'Tour nào kể chuyện lịch sử?',
  'Nên đi đâu trong 1 giờ?',
];

const kindLabel = (kind) => (kind === 'place' ? 'Địa điểm' : 'Tour');

function CiteMark({ item, index }) {
  if (!item) return null; // citation list not received yet (still streaming)
  const href = citationHref(item);
  const label = `Nguồn ${index}: ${kindLabel(item.kind)} ${item.title || ''}`.trim();
  return href ? (
    <Link className="chat-cite" to={href} aria-label={label} title={item.title}>
      {index}
    </Link>
  ) : (
    <span className="chat-cite chat-cite--plain" title={item.title} aria-label={label}>
      {index}
    </span>
  );
}

function AnswerText({ message }) {
  const cites = message.citations || [];
  const indexOf = (kind, id) => cites.findIndex((c) => c.kind === kind && c.id === id);
  return splitMarkers(message.content, { streaming: message.streaming }).map((p, i) => {
    if (p.type === 'text') return <span key={i}>{p.text}</span>;
    const n = indexOf(p.kind, p.id);
    return <CiteMark key={i} item={n >= 0 ? cites[n] : null} index={n + 1} />;
  });
}

function Sources({ items }) {
  if (!items?.length) return null;
  return (
    <div className="chat-sources">
      <p className="chat-sources__title">Nguồn</p>
      <ol className="chat-sources__list">
        {items.map((item) => {
          const href = citationHref(item);
          const title = item.title || item.id;
          return (
            <li key={`${item.kind}:${item.id}`}>
              <span className="chat-sources__kind">{kindLabel(item.kind)}</span>{' '}
              {href ? <Link to={href}>{title}</Link> : <span>{title}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Message({ message }) {
  if (message.role === 'user') {
    return (
      <li className={`chat-msg chat-msg--user ${message.failed ? 'is-failed' : ''}`}>
        <span className="sr-only">Bạn: </span>
        <div className="chat-msg__bubble">{message.content}</div>
        {message.failed ? <span className="chat-msg__note">Chưa gửi được</span> : null}
      </li>
    );
  }
  const waiting = message.streaming && !message.content;
  return (
    <li className="chat-msg chat-msg--bot" aria-busy={message.streaming ? 'true' : undefined}>
      <span className="sr-only">Trợ lý: </span>
      {waiting ? (
        <div className="chat-msg__bubble chat-typing" data-testid="chat-typing">
          <span className="chat-typing__dot" />
          <span className="chat-typing__dot" />
          <span className="chat-typing__dot" />
          <span className="sr-only">Trợ lý đang trả lời…</span>
        </div>
      ) : message.content ? (
        <div className="chat-msg__bubble" data-testid="chat-answer">
          <AnswerText message={message} />
          {message.streaming ? <span className="chat-caret" aria-hidden="true" /> : null}
          {message.streaming ? null : <Sources items={message.citations} />}
        </div>
      ) : null}
      {message.stopped ? <span className="chat-msg__note">Đã dừng</span> : null}
      {message.error ? (
        <div className="chat-msg__error" role="alert">
          <Icon name="alert-triangle" size={16} /> {message.error}
        </div>
      ) : null}
    </li>
  );
}

/**
 * @param {{ variant?: 'panel'|'page', titleId?: string, onClose?: () => void,
 *           onExpand?: () => void, onDisabled?: () => void }} props
 * Ref: { focus() } focuses the message box.
 */
const ChatView = forwardRef(function ChatView({ variant = 'page', titleId = 'chat-title', onClose, onExpand, onDisabled }, ref) {
  const chat = useChat({ onDisabled });
  const { status, messages, sending, error } = chat;
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      // Reopened panel: pick up turns made on the /chat page (never during a stream).
      reload: () => {
        if (!sending) chat.reload();
      },
    }),
    [chat.reload, sending],
  );

  // Keep the newest message in view while tokens arrive.
  const lastLen = messages.length ? messages[messages.length - 1].content.length : 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastLen, error]);

  async function submit(value) {
    const msg = (value ?? text).trim();
    if (!msg || sending || msg.length > MAX_MESSAGE_CHARS) return;
    setText('');
    await chat.send(msg);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function onNew() {
    chat.reset();
    setText('');
    inputRef.current?.focus();
  }

  const count = text.length;
  const near = count > MAX_MESSAGE_CHARS * 0.9;
  const disabled = status === 'disabled';

  return (
    <section className={`chat chat--${variant}`} aria-labelledby={titleId}>
      <header className="chat__head">
        <span className="chat__avatar" aria-hidden="true">
          <Icon name="headphones" size={18} />
        </span>
        <div className="chat__titles">
          <h2 id={titleId} className="chat__title">Trợ lý GeoSound</h2>
          <p className="chat__subtitle">Hỏi về tour và địa điểm trên GeoSound</p>
        </div>
        {!disabled ? (
          <button type="button" className="iconbtn iconbtn--sm" onClick={onNew} aria-label="Cuộc trò chuyện mới" title="Cuộc trò chuyện mới">
            <Icon name="plus" size={18} />
          </button>
        ) : null}
        {onExpand ? (
          <button type="button" className="iconbtn iconbtn--sm" onClick={onExpand} aria-label="Mở toàn màn hình" title="Mở toàn màn hình">
            <Icon name="chevron-up" size={18} />
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className="iconbtn iconbtn--sm" onClick={onClose} aria-label="Đóng trợ lý" title="Đóng">
            <Icon name="x" size={18} />
          </button>
        ) : null}
      </header>

      <div className="chat__body" ref={listRef}>
        {disabled ? (
          <div className="chat__empty" role="status">
            <Icon name="info" size={28} />
            <p className="chat__empty-title">{DISABLED_MESSAGE}</p>
            <p className="muted small">Trợ lý tạm thời không hoạt động. Bạn vẫn có thể tìm tour ở màn Khám phá.</p>
          </div>
        ) : status === 'loading' ? (
          <p className="muted chat__loading" role="status">
            <Icon name="loader" size={18} className="spin" /> Đang tải cuộc trò chuyện…
          </p>
        ) : status === 'error' ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="wifi-off" size={18} className="alert__icon" />
            <div>{error?.message}</div>
            <button type="button" className="btn btn--sm" onClick={chat.reload}>Thử lại</button>
          </div>
        ) : (
          <>
            {messages.length === 0 ? (
              <div className="chat__empty">
                <p className="chat__empty-title">Xin chào! Bạn muốn khám phá gì hôm nay?</p>
                <p className="muted small">Chọn một gợi ý hoặc nhập câu hỏi của bạn.</p>
                <div className="chat__chips" role="group" aria-label="Gợi ý câu hỏi">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="chip chat__chip" onClick={() => submit(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <ol className="chat__log" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Cuộc trò chuyện">
              {messages.map((m) => (
                <Message key={m.id} message={m} />
              ))}
            </ol>
            {error && status === 'ready' ? (
              <div className="alert alert--warn chat__alert" role="alert" data-testid="chat-error">
                <Icon name={error.kind === 'offline' ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
                <div>{error.message}</div>
                {error.retryText && error.kind !== 'invalid' ? (
                  <button type="button" className="btn btn--sm" onClick={chat.retry}>Thử lại</button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {disabled ? null : (
        <form
          className="chat__composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor={`${titleId}-input`} className="sr-only">Câu hỏi cho trợ lý</label>
          <textarea
            id={`${titleId}-input`}
            ref={inputRef}
            className="chat__input"
            rows={1}
            value={text}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="Hỏi về tour, địa điểm…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby={`${titleId}-count`}
          />
          <span id={`${titleId}-count`} className={`chat__count ${near ? 'is-near' : ''}`} aria-live={near ? 'polite' : 'off'}>
            {count}/{MAX_MESSAGE_CHARS}
            <span className="sr-only"> ký tự</span>
          </span>
          {sending ? (
            <button type="button" className="btn btn--sm chat__send" onClick={chat.stop}>
              <Icon name="pause" size={16} /> Dừng
            </button>
          ) : (
            <button type="submit" className="btn btn--primary btn--sm chat__send" disabled={!text.trim() || status !== 'ready'}>
              Gửi
            </button>
          )}
        </form>
      )}
    </section>
  );
});

export default ChatView;
