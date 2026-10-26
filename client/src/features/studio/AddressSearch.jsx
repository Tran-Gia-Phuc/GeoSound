// =========================================================
// AddressSearch — ô tìm địa chỉ nổi trên bản đồ Studio (UC10 bước 3): gõ ≥ 3 ký
// tự (debounce 500 ms) → danh sách gợi ý → chọn → ghim tới đó.
// Combobox a11y: mũi tên lên/xuống + Enter để chọn, Esc để đóng.
// =========================================================
import { useEffect, useId, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { searchAddress } from '../../lib/geocode.js';

/** @param {{ onPick: (r: { lat: number, lng: number, name: string }) => void }} props */
export default function AddressSearch({ onPick }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const picked = useRef(''); // tên vừa chọn — không tìm lại khi ô hiện đúng tên đó

  useEffect(() => {
    const term = q.trim();
    if (term && term === picked.current) return undefined;
    if (term.length < 3) {
      setResults([]);
      setError('');
      return undefined;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setBusy(true);
      searchAddress(term, { signal: ctrl.signal })
        .then((r) => {
          setResults(r);
          setError(r.length ? '' : 'Không tìm thấy địa chỉ phù hợp');
          setOpen(true);
          setActive(-1);
        })
        .catch((e) => e.name !== 'AbortError' && setError(e.message || 'Không tìm được địa chỉ'))
        .finally(() => setBusy(false));
    }, 500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const choose = (r) => {
    onPick({ lat: r.lat, lng: r.lng, name: r.name });
    picked.current = r.name.trim();
    setQ(r.name);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[Math.max(0, active)]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="addrsearch">
      <div className="addrsearch__box">
        <Icon name={busy ? 'loader' : 'search'} size={18} className={busy ? 'spin' : ''} />
        <input
          className="input"
          type="search"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-label="Tìm địa chỉ"
          placeholder="Tìm địa chỉ, ví dụ: Chùa Cầu Hội An"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
      </div>
      {open && (results.length || error) ? (
        <ul className="addrsearch__list" id={`${id}-list`} role="listbox">
          {results.map((r, i) => (
            <li
              key={`${r.lat},${r.lng},${i}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`addrsearch__opt ${i === active ? 'is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
            >
              <b>{r.name}</b>
              <span className="muted small">{r.displayName}</span>
            </li>
          ))}
          {!results.length && error ? <li className="addrsearch__empty muted small">{error}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
