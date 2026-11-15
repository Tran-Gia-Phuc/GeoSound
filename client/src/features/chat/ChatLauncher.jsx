// =========================================================
// ChatLauncher — floating "Trợ lý" button of the app shell + chat panel
// (bottom sheet on phones, side panel on desktop ≥ 900px).
//   - Probes the chatbot once per page load: hidden when it is off (404).
//   - Esc or "Đóng" closes the panel and gives focus back to the button.
//   - "Mở toàn màn hình" opens the /chat page with the same session.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { probeChat } from '../../lib/chat.js';
import ChatView from './ChatView.jsx';
import './chat.css';

export default function ChatLauncher() {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(null); // null = probing / unknown
  const [probed, setProbed] = useState(false);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // panel kept after the first open
  const buttonRef = useRef(null);
  const viewRef = useRef(null);

  useEffect(() => {
    let alive = true;
    probeChat().then((on) => {
      if (!alive) return;
      setEnabled(on);
      setProbed(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  function show() {
    const reopen = mounted;
    setMounted(true);
    setOpen(true);
    requestAnimationFrame(() => {
      if (reopen) viewRef.current?.reload();
      viewRef.current?.focus();
    });
  }

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Chatbot off: no button. The panel stays only while it is open (it shows "Chatbot đang tắt").
  if (!probed || (enabled === false && !open)) return null;

  return (
    <>
      {open ? null : (
        <button
          ref={buttonRef}
          type="button"
          className="chat-fab"
          onClick={show}
          aria-label="Mở trợ lý GeoSound"
          aria-haspopup="dialog"
        >
          <Icon name="headphones" size={22} />
          <span className="chat-fab__label">Hỏi trợ lý</span>
        </button>
      )}
      {mounted ? (
        <div
          className="chat-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="chat-panel-title"
          hidden={!open}
        >
          <ChatView
            ref={viewRef}
            variant="panel"
            titleId="chat-panel-title"
            onClose={close}
            onExpand={() => {
              setOpen(false);
              navigate('/chat');
            }}
            onDisabled={() => setEnabled(false)}
          />
        </div>
      ) : null}
    </>
  );
}
