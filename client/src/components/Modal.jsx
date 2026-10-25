// Modal nền tối, đóng bằng Esc / nhấn nền. Khóa focus cơ bản.
import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

export default function Modal({ open, onClose, title, children, labelledBy = 'modal-title' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal__card" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={ref}>
        <div className="modal__head">
          <h2 id={labelledBy} className="modal__title">
            {title}
          </h2>
          {onClose ? (
            <button className="iconbtn" onClick={onClose} aria-label="Đóng">
              <Icon name="x" size={20} />
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}
