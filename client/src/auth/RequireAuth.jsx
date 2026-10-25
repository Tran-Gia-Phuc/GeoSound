// =========================================================
// RequireAuth — chặn route cần đăng nhập (UC07/UC08). Chưa đăng nhập → đẩy sang
// /login kèm ?next= để quay lại sau khi đăng nhập xong.
// =========================================================
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export default function RequireAuth({ children }) {
  const { authenticated } = useAuth();
  const location = useLocation();
  if (!authenticated) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}
