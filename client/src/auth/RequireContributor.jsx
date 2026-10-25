// =========================================================
// RequireContributor — chặn khu "Studio" (UC09–UC13) chỉ cho người đóng góp.
//   - Chưa đăng nhập  → /login?next=  (quay lại sau khi đăng nhập).
//   - Đăng nhập nhưng KHÔNG phải contributor → màn thông báo (API sẽ 403).
// =========================================================
import { Link, Navigate, useLocation } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { useAuth } from './AuthContext.jsx';

export default function RequireContributor({ children }) {
  const { authenticated, isContributor } = useAuth();
  const location = useLocation();

  if (!authenticated) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (!isContributor) {
    return (
      <div className="screen screen--center">
        <div className="emptybox">
          <Icon name="info" size={40} />
          <h2>Khu vực dành cho người đóng góp</h2>
          <p>
            Tài khoản của bạn chưa có quyền tạo &amp; quản lý tour. Hãy liên hệ quản trị viên để
            được cấp quyền đóng góp nội dung.
          </p>
          <Link to="/" className="btn btn--ghost">
            <Icon name="arrow-left" size={18} /> Về trang chủ
          </Link>
        </div>
      </div>
    );
  }

  return children;
}
