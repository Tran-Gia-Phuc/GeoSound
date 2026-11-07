// =========================================================
// AuthorPage (/authors/:id) — UC18 public author page (#118, #120). No sign-in needed.
//   - Avatar (initials fallback), name, bio, joined date, follower count.
//   - Follow / Đang theo dõi (signed in; a guest goes to login and back; hidden on
//     your own page, which links to the profile editor instead). The count moves at
//     once and rolls back when the request fails.
//   - Public tours of the author (newest first, "Xem thêm"); E1: none.
//   - 404: "Không tìm thấy tác giả".
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import TourCard from '../tours/TourCard.jsx';
import AuthorAvatar from './AuthorAvatar.jsx';
import { getAuthor, getFollowState, listAuthorTours, setFollowing } from '../../lib/authors.js';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const errorMessage = (e, fallback) => (e?.offline ? OFFLINE_MESSAGE : e?.message || fallback);
const PAGE_SIZE = 12;

function joinedText(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `Tham gia tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
}

export default function AuthorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { authenticated, user } = useAuth();
  const isSelf = authenticated && user?.id === id;

  const [author, setAuthor] = useState(null);
  const [error, setError] = useState(null); // { message, notFound }
  const [following, setFollowingState] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [tours, setTours] = useState(null);
  const [toursTotal, setToursTotal] = useState(0);
  const [toursPage, setToursPage] = useState(1);
  const [toursError, setToursError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const pending = useRef(false);

  const loadAuthor = useCallback(async () => {
    setError(null);
    setAuthor(null);
    try {
      setAuthor(await getAuthor(id));
    } catch (e) {
      setError(
        e?.status === 404
          ? { message: 'Không tìm thấy tác giả', notFound: true }
          : { message: errorMessage(e, 'Chưa tải được trang tác giả') },
      );
    }
  }, [id]);

  const loadTours = useCallback(async () => {
    setToursError('');
    setTours(null);
    try {
      const res = await listAuthorTours(id, { page: 1, limit: PAGE_SIZE });
      setTours(res.tours);
      setToursTotal(res.total);
      setToursPage(1);
    } catch (e) {
      setToursError(errorMessage(e, 'Chưa tải được tour của tác giả'));
    }
  }, [id]);

  useEffect(() => {
    loadAuthor();
    loadTours();
  }, [loadAuthor, loadTours]);

  // Follow state of the signed-in user (also a fresher follower count).
  useEffect(() => {
    if (!authenticated || isSelf || !author) return undefined;
    let alive = true;
    getFollowState(id)
      .then((s) => {
        if (!alive || pending.current) return;
        setFollowingState(!!s.following);
        if (typeof s.followerCount === 'number') setAuthor((a) => (a ? { ...a, followerCount: s.followerCount } : a));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [authenticated, isSelf, id, author?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function moreTours() {
    setLoadingMore(true);
    setToursError('');
    try {
      const res = await listAuthorTours(id, { page: toursPage + 1, limit: PAGE_SIZE });
      setTours((cur) => {
        const seen = new Set((cur ?? []).map((t) => t.id));
        return [...(cur ?? []), ...res.tours.filter((t) => !seen.has(t.id))];
      });
      setToursTotal(res.total);
      setToursPage(toursPage + 1);
    } catch (e) {
      setToursError(errorMessage(e, 'Chưa tải thêm được tour'));
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleFollow() {
    if (!authenticated) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    const next = !following;
    const before = { following, count: author.followerCount ?? 0 };
    // Optimistic: flip and move the count now, roll back on failure.
    pending.current = true;
    setFollowBusy(true);
    setFollowingState(next);
    setAuthor((a) => ({ ...a, followerCount: Math.max(0, (a.followerCount ?? 0) + (next ? 1 : -1)) }));
    try {
      const res = await setFollowing(id, next);
      setFollowingState(!!res.following);
      if (typeof res.followerCount === 'number') setAuthor((a) => ({ ...a, followerCount: res.followerCount }));
      toast.show(next ? `Đã theo dõi ${author.fullName}` : `Đã bỏ theo dõi ${author.fullName}`);
    } catch (e) {
      setFollowingState(before.following);
      setAuthor((a) => ({ ...a, followerCount: before.count }));
      toast.show(errorMessage(e, next ? 'Chưa theo dõi được tác giả' : 'Chưa bỏ theo dõi được tác giả'), { tone: 'danger' });
    } finally {
      pending.current = false;
      setFollowBusy(false);
    }
  }

  if (error) {
    return (
      <div className="page page--narrow author-page">
        <AppHeader title="Tác giả" backTo="/" />
        {error.notFound ? (
          <div className="card author-empty">
            <Icon name="user" size={32} />
            <b>Không tìm thấy tác giả</b>
            <p className="muted small">Trang tác giả này không tồn tại hoặc không còn hoạt động.</p>
            <Link className="btn btn--ghost" to="/">Về Khám phá</Link>
          </div>
        ) : (
          <div className="alert alert--warn" role="alert">
            <Icon name={error.message === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
            <div>{error.message}</div>
            <button className="btn btn--sm" onClick={loadAuthor}>Thử lại</button>
          </div>
        )}
      </div>
    );
  }

  if (!author) {
    return (
      <div className="page page--narrow author-page">
        <AppHeader title="Tác giả" backTo="/" />
        <p className="muted author-loading"><Icon name="loader" size={18} className="spin" /> Đang tải…</p>
      </div>
    );
  }

  const count = author.followerCount ?? 0;

  return (
    <div className="page page--narrow author-page">
      <AppHeader title="Tác giả" backTo="/" />

      <section className="card author-head" aria-label="Thông tin tác giả">
        <AuthorAvatar key={author.avatarUrl || 'none'} name={author.fullName} url={author.avatarUrl} size={72} />
        <div className="author-head__info">
          <h2 className="author-head__name">{author.fullName}</h2>
          <span className="muted small author-head__meta">
            <span data-testid="follower-count">{count} người theo dõi</span>
            {joinedText(author.joinedAt) ? <> · {joinedText(author.joinedAt)}</> : null}
          </span>
        </div>
        {isSelf ? (
          <Link className="btn btn--ghost btn--sm author-head__action" to="/account/profile">
            <Icon name="edit" size={16} /> Sửa hồ sơ
          </Link>
        ) : (
          <button
            type="button"
            className={`btn btn--sm author-head__action ${following ? 'btn--ghost' : 'btn--primary'}`}
            aria-pressed={following}
            disabled={followBusy}
            onClick={toggleFollow}
          >
            {following ? <><Icon name="check-circle" size={16} /> Đang theo dõi</> : <><Icon name="plus" size={16} /> Theo dõi</>}
          </button>
        )}
        {author.bio ? <p className="author-head__bio">{author.bio}</p> : null}
      </section>

      <section className="author-tours" aria-labelledby="author-tours-h">
        <h2 className="section-title" id="author-tours-h">
          Tour công khai{tours ? ` (${toursTotal})` : ''}
        </h2>
        {toursError && !tours ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{toursError}</div>
            <button className="btn btn--sm" onClick={loadTours}>Thử lại</button>
          </div>
        ) : tours === null ? (
          <p className="muted author-loading"><Icon name="loader" size={18} className="spin" /> Đang tải tour…</p>
        ) : tours.length === 0 ? (
          <div className="card author-empty">
            <Icon name="headphones" size={28} />
            <b>Tác giả chưa có tour công khai</b>
          </div>
        ) : (
          <>
            <ul className="tourlist tourlist--compact">
              {tours.map((t) => <TourCard key={t.id} tour={t} />)}
            </ul>
            {toursError ? (
              <div className="alert alert--warn" role="alert">
                <Icon name="alert-triangle" size={18} className="alert__icon" />
                <div>{toursError}</div>
                <button className="btn btn--sm" onClick={moreTours}>Thử lại</button>
              </div>
            ) : tours.length < toursTotal ? (
              <button className="btn loadmore" onClick={moreTours} disabled={loadingMore}>
                {loadingMore ? <Icon name="loader" size={16} className="spin" /> : null} Xem thêm
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
