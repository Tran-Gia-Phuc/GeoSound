// =========================================================
// RequireContributor — chặn khu "Studio" (UC09–UC13) chỉ cho người đóng góp.
//   - Chưa đăng nhập  → /login?next=  (quay lại sau khi đăng nhập).
//   - Đăng nhập bằng tài khoản khách → giải thích + mở đường đăng ký tài khoản
//     tác giả (tự chọn vai trò khi đăng ký — quyết định D2), không còn "liên hệ
//     quản trị viên" vì app chưa có giao diện quản trị.
// =========================================================
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { useAuth } from './AuthContext.jsx';

export default function RequireContributor({ children }) {
  const { authenticated, isContributor, user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (!authenticated) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (!isContributor) {
    const registerAsAuthor = () => {
      logout();
      navigate('/register?role=contributor', { replace: true });
    };
    return (
      <div className="screen screen--center">
        <div className="emptybox">
          <Icon name="mic" size={40} />
          <h2>Studio dành cho tác giả tour</h2>
          <p>
            {user?.email ? <b>{user.email}</b> : 'Tài khoản này'} là tài khoản khách du lịch. Để tạo và xuất bản
            tour audio, hãy đăng ký một tài khoản tác giả (dùng email khác).
          </p>
          <div className="row">
            <Link to="/" className="btn btn--ghost">
              <Icon name="arrow-left" size={18} /> Về Khám phá
            </Link>
            <button className="btn btn--primary" onClick={registerAsAuthor}>
              Đăng ký tài khoản tác giả
            </button>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
