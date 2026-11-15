// =========================================================
// ChatPage (/chat) — the chatbot on a full page (same session as the panel).
// Chatbot off -> the view shows "Chatbot đang tắt".
// =========================================================
import { useEffect, useRef } from 'react';
import ChatView from './ChatView.jsx';
import './chat.css';

export default function ChatPage() {
  const viewRef = useRef(null);
  useEffect(() => {
    // Desktop only: focusing on a phone would pop the keyboard over the conversation.
    if (window.matchMedia?.('(min-width: 900px)').matches) viewRef.current?.focus();
  }, []);
  return (
    <div className="page page--narrow chat-page">
      <ChatView ref={viewRef} variant="page" titleId="chat-page-title" />
    </div>
  );
}
