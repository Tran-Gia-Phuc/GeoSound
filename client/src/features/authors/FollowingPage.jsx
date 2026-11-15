// =========================================================
// FollowingPage (/account/following) — UC18 (#120): the authors I follow, newest
// follow first, 20 per page with "Xem thêm"; each row opens the author page.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import AuthorAvatar from './AuthorAvatar.jsx';
import { listFollowing } from '../../lib/authors.js';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const errorMessage = (e, fallback) => (e?.offline ? OFFLINE_MESSAGE : e?.message || fallback);
const PAGE_SIZE = 20;

export default function FollowingPage() {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setItems(null);
    try {
      const res = await listFollowing({ page: 1, limit: PAGE_SIZE });
      setItems(res?.items ?? []);
      setTotal(res?.total ?? 0);
      setPage(1);
    } catch (e) {
      setError(errorMessage(e, 'Chưa tải được danh sách tác giả'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function more() {
    setLoadingMore(true);
    setMoreError('');
    try {
      const res = await listFollowing({ page: page + 1, limit: PAGE_SIZE });
      setItems((cur) => {
        const seen = new Set(cur.map((a) => a.id));
        return [...cur, ...(res?.items ?? []).filter((a) => !seen.has(a.id))];
      });
      setTotal(res?.total ?? total);
      setPage(page + 1);
    } catch (e) {
      setMoreError(errorMessage(e, 'Chưa tải thêm được'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="page page--narrow following">
      <AppHeader title="Tác giả đang theo dõi" backTo="/account" />

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={error === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{error}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : items === null ? (
        <p className="muted author-loading"><Icon name="loader" size={18} className="spin" /> Đang tải…</p>
      ) : items.length === 0 ? (
        <div className="card author-empty">
          <Icon name="user" size={32} />
          <b>Bạn chưa theo dõi tác giả nào</b>
          <p className="muted small">Mở trang tác giả từ một tour và chọn "Theo dõi".</p>
          <Link className="btn btn--ghost" to="/">Khám phá tour</Link>
        </div>
      ) : (
        <>
          <p className="muted small">{total} tác giả</p>
          <ul className="following__list" aria-label="Tác giả đang theo dõi">
            {items.map((a) => (
              <li key={a.id}>
                <Link className="card following__row" to={`/authors/${encodeURIComponent(a.id)}`} data-testid="following-row">
                  <AuthorAvatar key={a.avatarUrl || 'none'} name={a.fullName} url={a.avatarUrl} size={44} />
                  <span className="following__info">
                    <b>{a.fullName}</b>
                    <span className="muted small">{a.followerCount ?? 0} người theo dõi</span>
                  </span>
                  <Icon name="chevron-left" size={16} className="menu__chev" />
                </Link>
              </li>
            ))}
          </ul>
          {moreError ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>{moreError}</div>
              <button className="btn btn--sm" onClick={more}>Thử lại</button>
            </div>
          ) : items.length < total ? (
            <button className="btn btn--ghost btn--block" onClick={more} disabled={loadingMore}>
              {loadingMore ? <Icon name="loader" size={16} className="spin" /> : null} Xem thêm
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
