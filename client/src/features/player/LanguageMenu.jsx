// LanguageMenu — đổi ngôn ngữ nghe (UC04 bước 12 / A5.5, UC12). Popover đơn giản.
import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { langLabel } from '../../lib/format.js';

export default function LanguageMenu({ languages = [], selected, voiceLabel, onChange, busy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (languages.length <= 1) {
    return (
      <span className="chip" title={voiceLabel}>
        <Icon name="languages" size={14} /> {langLabel(selected)}
      </span>
    );
  }

  return (
    <div className="langmenu" ref={ref}>
      <button className="iconbtn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)} aria-label="Đổi ngôn ngữ" disabled={busy}>
        {busy ? <Icon name="loader" size={18} className="spin" /> : <Icon name="languages" size={18} />}
      </button>
      {open ? (
        <ul className="langmenu__list" role="listbox" aria-label="Ngôn ngữ nghe">
          {languages.map((code) => (
            <li key={code} role="option" aria-selected={code === selected}>
              <button
                className={`langmenu__item ${code === selected ? 'is-active' : ''}`}
                onClick={() => {
                  setOpen(false);
                  if (code !== selected) onChange?.(code);
                }}
              >
                <span>{langLabel(code)}</span>
                {code === selected ? <Icon name="check-circle" size={16} /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
