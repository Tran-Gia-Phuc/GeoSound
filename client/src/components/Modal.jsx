// Modal / bottom sheet nền tối (điện thoại: trượt từ đáy). a11y:
//   - Esc / chạm nền để đóng
//   - giữ focus TRONG hộp (Tab / Shift+Tab vòng lại), focus vào hộp khi mở
//   - đóng thì trả focus về phần tử đã mở hộp
//   - khoá cuộn trang nền khi đang mở
import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, children, labelledBy = 'modal-title' }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const card = ref.current;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !card) return;
      const items = [...card.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        card.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    if (!card?.contains(document.activeElement)) card?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, [open]);

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
