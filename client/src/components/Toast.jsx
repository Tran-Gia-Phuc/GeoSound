// =========================================================
// Toast — thông báo ngắn nổi ở đáy màn, có thể kèm 1 hành động ("Xem", "Hoàn
// tác"). role=status để trình đọc màn hình đọc to. Tự ẩn sau vài giây.
//   const toast = useToast();  toast.show('Đã thêm', { action: { label, onClick } })
// =========================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { id, message, action?, tone? }
  const timer = useRef(null);

  const hide = useCallback(() => setToast(null), []);
  const show = useCallback((message, { action, tone, duration = 5000 } = {}) => {
    clearTimeout(timer.current);
    setToast({ id: Date.now(), message, action, tone });
    timer.current = setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const value = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast ? (
          <div key={toast.id} className={`toast ${toast.tone ? `toast--${toast.tone}` : ''}`}>
            <span className="toast__msg">{toast.message}</span>
            {toast.action ? (
              <button
                className="toast__action"
                onClick={() => {
                  toast.action.onClick();
                  hide();
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast phải nằm trong <ToastProvider>');
  return ctx;
}
