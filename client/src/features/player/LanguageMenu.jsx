// LanguageMenu — đổi ngôn ngữ nghe (UC04 bước 12 / A5.5, UC12). Popover đơn giản.
// Two groups: the languages the tour has (an automatic one is tagged "Tự động") and, when the
// page can ask for it (onTranslate), the supported languages a tourist can have translated.
import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { langLabel } from '../../lib/format.js';

export default function LanguageMenu({ languages = [], kinds = {}, translatable = [], selected, voiceLabel, onChange, onTranslate, busy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const askable = onTranslate ? translatable : [];

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

  if (languages.length <= 1 && !askable.length) {
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
        <div className="langmenu__list">
          <ul className="langmenu__group" role="listbox" aria-label="Ngôn ngữ nghe">
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
                  {kinds[code] === 'auto' ? <span className="langmenu__tag">Tự động</span> : null}
                  {code === selected ? <Icon name="check-circle" size={16} /> : null}
                </button>
              </li>
            ))}
          </ul>
          {askable.length ? (
            <>
              <div className="langmenu__label" id="langmenu-auto">Dịch tự động</div>
              <ul className="langmenu__group" aria-labelledby="langmenu-auto">
                {askable.map((code) => (
                  <li key={code}>
                    <button
                      className="langmenu__item"
                      onClick={() => {
                        setOpen(false);
                        onTranslate(code);
                      }}
                    >
                      <span>{langLabel(code)}</span>
                      <Icon name="languages" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
