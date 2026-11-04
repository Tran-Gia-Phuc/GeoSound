// =========================================================
// AdminHomePage (/admin) — entry of the admin area: one menu item per admin screen.
// =========================================================
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import AdminGate from './AdminGate.jsx';
import { ADMIN_LINKS } from './AdminNav.jsx';

export default function AdminHomePage() {
  return (
    <AdminGate title="Quản trị">
      <div className="page page--narrow">
        <AppHeader title="Quản trị" backTo="/account" />
        <nav className="menu" aria-label="Màn quản trị">
          {ADMIN_LINKS.map((l) => (
            <Link key={l.to} className="menu__item" to={l.to}>
              <Icon name={l.icon} size={20} />
              <span>
                {l.label}
                <span className="muted small menu__sub">{l.hint}</span>
              </span>
              <Icon name="chevron-left" size={16} className="menu__chev" />
            </Link>
          ))}
        </nav>
      </div>
    </AdminGate>
  );
}
