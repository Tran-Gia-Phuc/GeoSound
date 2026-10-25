// =========================================================
// AccountMenu — widget tài khoản ở header. Chưa đăng nhập: nút "Đăng nhập".
// Đã đăng nhập: avatar (chữ cái đầu) + menu thả xuống (hồ sơ, đăng xuất).
// =========================================================
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { useAuth } from './AuthContext.jsx';

function initials(user) {
  const s = (user?.fullName || user?.email || '?').trim();
  return s.slice(0, 1).toUpperCase();
}

export default function AccountMenu() {
  const { authenticated, user, logout, isContributor } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!authenticated) {
    return (
      <Link to="/login" className="btn btn--ghost">Đăng nhập</Link>
    );
  }

  return (
    <div className="account" ref={ref}>
      <button
        className="account__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="account__avatar" aria-hidden="true">{initials(user)}</span>
        <span className="account__name">{user?.fullName || user?.email}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>

      {open ? (
        <div className="account__menu" role="menu">
          <div className="account__meta">
            <b>{user?.fullName || 'Khách du lịch'}</b>
            <span>{user?.email}</span>
          </div>
          {isContributor ? (
            <Link to="/studio" className="account__item" role="menuitem" onClick={() => setOpen(false)}>
              <Icon name="map-pin" size={16} /> Studio — Tour của tôi
            </Link>
          ) : null}
          <Link to="/itineraries" className="account__item" role="menuitem" onClick={() => setOpen(false)}>
            <Icon name="list" size={16} /> Lịch trình của tôi
          </Link>
          <button
            className="account__item account__item--danger"
            role="menuitem"
            onClick={() => {
              logout();
              setOpen(false);
              navigate('/');
            }}
          >
            <Icon name="arrow-left" size={16} /> Đăng xuất
          </button>
        </div>
      ) : null}
    </div>
  );
}
