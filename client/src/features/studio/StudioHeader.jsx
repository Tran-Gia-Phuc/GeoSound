// =========================================================
// StudioHeader — thanh đầu dùng chung cho khu Studio (UC09–UC13).
// Nút quay lại (tuỳ chọn) + tiêu đề, bên phải là tài khoản + đổi giao diện.
// =========================================================
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import AccountMenu from '../../auth/AccountMenu.jsx';

/**
 * @param {{ title?: string, backTo?: string|number, subtitle?: React.ReactNode }} props
 * backTo: đường dẫn để quay lại; số (-1) = quay lại lịch sử; bỏ trống = logo thương hiệu.
 */
export default function StudioHeader({ title, backTo, subtitle }) {
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();

  return (
    <header className="studio__top">
      <div className="studio__topleft">
        {backTo !== undefined ? (
          <button
            className="iconbtn"
            onClick={() => (typeof backTo === 'number' ? navigate(backTo) : navigate(backTo))}
            aria-label="Quay lại"
          >
            <Icon name="arrow-left" size={18} />
          </button>
        ) : (
          <Link to="/" className="brand" aria-label="Về trang chủ GeoSound">
            <span className="brand__logo"><Icon name="headphones" size={20} /></span>
            <span className="brand__name">GeoSound</span>
          </Link>
        )}
        {title ? (
          <div className="studio__heading">
            <h1 className="studio__title">{title}</h1>
            {subtitle ? <p className="studio__subtitle muted small">{subtitle}</p> : null}
          </div>
        ) : null}
      </div>
      <div className="home__topright">
        <AccountMenu />
        <button className="iconbtn" onClick={toggle} aria-label="Đổi giao diện sáng/tối">
          <Icon name={isDark ? 'sun' : 'moon'} size={18} />
        </button>
      </div>
    </header>
  );
}

/** Chip trạng thái tour dùng chung (UC09 danh sách + trình chỉnh sửa). */
export function StatusChip({ meta }) {
  return <span className={`statuschip statuschip--${meta.tone}`}>{meta.label}</span>;
}
