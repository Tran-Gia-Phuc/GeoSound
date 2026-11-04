// =========================================================
// AdminGate — admin-only screens. The route is already behind RequireAuth (signed in);
// a signed-in non-admin sees a notice and the page (and its API calls) never mounts.
// =========================================================
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

export const ADMIN_ONLY_MESSAGE = 'Chỉ quản trị viên được xem trang này';

export default function AdminGate({ title, children }) {
  const { isAdmin } = useAuth();
  if (isAdmin) return children;
  return (
    <div className="page page--narrow">
      <AppHeader title={title} backTo="/account" />
      <div className="alert alert--warn" role="alert">
        <Icon name="alert-triangle" size={18} className="alert__icon" />
        <div>{ADMIN_ONLY_MESSAGE}</div>
      </div>
    </div>
  );
}
