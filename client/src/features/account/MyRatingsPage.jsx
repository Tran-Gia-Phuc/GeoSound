// =========================================================
// MyRatingsPage (/account/ratings) — dedicated page for signed-in users to
// review, filter, edit, or delete their past tour ratings.
// =========================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatDateTime } from '../../lib/format.js';
import {
  RATING_COMMENT_MAX,
  RATINGS_PAGE_SIZE,
  deleteMyRating,
  listMyRatings,
  saveMyRating,
} from '../../lib/ratings.js';
import './my-ratings.css';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const STAR_VALUES = [1, 2, 3, 4, 5];
const errorMessage = (err, fallback) => (err?.offline ? OFFLINE_MESSAGE : err?.message || fallback);

function Stars({ value, size = 15 }) {
  return (
    <span className="myrating-stars" role="img" aria-label={`${value} trên 5 sao`}>
      {STAR_VALUES.map((n) => (
        <Icon key={n} name="star" size={size} className={n <= value ? 'myrating-star myrating-star--on' : 'myrating-star'} />
      ))}
    </span>
  );
}

function InlineEditForm({ item, busy, error, onSave, onCancel }) {
  const [stars, setStars] = useState(item.stars || 5);
  const [comment, setComment] = useState(item.comment || '');
  const [starsError, setStarsError] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (!stars) {
      setStarsError(true);
      return;
    }
    onSave(item, { stars, comment });
  }

  return (
    <form className="myrating-edit" onSubmit={submit} noValidate aria-label="Sửa đánh giá">
      <div className="myrating-picker" role="radiogroup" aria-label="Chọn số sao">
        {STAR_VALUES.map((n) => (
          <label key={n} className={`myrating-picker__star ${n <= stars ? 'is-on' : ''}`}>
            <input
              type="radio"
              name={`edit-stars-${item.id}`}
              value={n}
              checked={stars === n}
              aria-label={`${n} sao`}
              onChange={() => {
                setStars(n);
                setStarsError(false);
              }}
            />
            <Icon name="star" size={24} />
          </label>
        ))}
      </div>
      {starsError ? (
        <p className="field__err" role="alert">Vui lòng chọn số sao</p>
      ) : null}

      <label className="field">
        <span className="field__label">Nhận xét (không bắt buộc)</span>
        <textarea
          className="input myrating-edit__textarea"
          rows={3}
          maxLength={RATING_COMMENT_MAX}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Chia sẻ cảm nhận của bạn về tour"
        />
        <span className="field__hint myrating-edit__count">
          {comment.length}/{RATING_COMMENT_MAX}
        </span>
      </label>

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={16} className="alert__icon" />
          <div>{error}</div>
        </div>
      ) : null}

      <div className="myrating-edit__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} disabled={busy}>
          Huỷ
        </button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
          {busy ? <Icon name="loader" size={14} className="spin" /> : null}
          Lưu thay đổi
        </button>
      </div>
    </form>
  );
}

export default function MyRatingsPage() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const [starFilter, setStarFilter] = useState(0); // 0 = all, 1..5 = exact stars
  const [editingId, setEditingId] = useState(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setItems(null);
    try {
      const res = await listMyRatings({ page: 1, limit: RATINGS_PAGE_SIZE });
      setItems(res?.items ?? []);
      setTotal(res?.total ?? 0);
      setPage(res?.page || 1);
    } catch (e) {
      setError(errorMessage(e, 'Chưa tải được danh sách đánh giá'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    setMoreError('');
    try {
      const res = await listMyRatings({ page: page + 1, limit: RATINGS_PAGE_SIZE });
      setItems((cur) => {
        const seen = new Set((cur || []).map((r) => r.id));
        return [...(cur || []), ...(res?.items ?? []).filter((r) => !seen.has(r.id))];
      });
      setTotal(res?.total ?? total);
      setPage(res?.page || page + 1);
    } catch (e) {
      setMoreError(errorMessage(e, 'Chưa tải thêm được đánh giá'));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSave(item, draft) {
    setSaveBusy(true);
    setSaveError('');
    try {
      const body = await saveMyRating(item.tourId, draft);
      const updated = body?.rating;
      setItems((cur) =>
        (cur || []).map((r) =>
          r.id === item.id
            ? {
                ...r,
                stars: updated?.stars ?? draft.stars,
                comment: updated?.comment !== undefined ? updated.comment : draft.comment.trim() || null,
                updatedAt: updated?.updatedAt || new Date().toISOString(),
                tour: r.tour && body?.summary ? { ...r.tour, ...body.summary } : r.tour,
              }
            : r,
        ),
      );
      setEditingId(null);
      toast.show('Đã cập nhật đánh giá');
    } catch (e) {
      setSaveError(errorMessage(e, 'Chưa cập nhật được đánh giá'));
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setDeleteBusy(true);
    try {
      await deleteMyRating(target.tourId);
      setItems((cur) => (cur || []).filter((r) => r.id !== target.id));
      setTotal((t) => Math.max(0, t - 1));
      toast.show('Đã xoá đánh giá');
    } catch (e) {
      if (e?.status === 404) {
        setItems((cur) => (cur || []).filter((r) => r.id !== target.id));
        setTotal((t) => Math.max(0, t - 1));
        toast.show('Đã xoá đánh giá');
      } else {
        toast.show(errorMessage(e, 'Chưa xoá được đánh giá'), { tone: 'danger' });
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  const visibleItems = useMemo(() => {
    if (!items) return [];
    if (!starFilter) return items;
    return items.filter((r) => r.stars === starFilter);
  }, [items, starFilter]);

  return (
    <div className="page myratings">
      <div className="myratings__hero">
        <div className="myratings__hero-top">
          <AppHeader title="Đánh giá của tôi" backTo="/account" />
          <span className="myratings__count-pill">
            <Icon name="star" size={14} />
            {total} đánh giá
          </span>
        </div>
        <p className="myratings__subtitle">
          Xem lại các nhận xét và số sao bạn đã gửi cho từng tour trên GeoSound.
        </p>
      </div>

      {items && items.length > 0 ? (
        <div className="myratings__bar" role="group" aria-label="Lọc theo số sao">
          <button
            type="button"
            className={`myratings__chip ${starFilter === 0 ? 'is-active' : ''}`}
            aria-pressed={starFilter === 0}
            onClick={() => setStarFilter(0)}
          >
            Tất cả ({items.length})
          </button>
          {[5, 4, 3, 2, 1].map((s) => {
            const cnt = items.filter((r) => r.stars === s).length;
            return (
              <button
                key={s}
                type="button"
                className={`myratings__chip ${starFilter === s ? 'is-active' : ''}`}
                aria-pressed={starFilter === s}
                onClick={() => setStarFilter(s)}
              >
                {s} <Icon name="star" size={12} /> ({cnt})
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={error === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{error}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : items === null ? (
        <p className="muted myratings__loading">
          <Icon name="loader" size={18} className="spin" /> Đang tải đánh giá…
        </p>
      ) : visibleItems.length === 0 ? (
        <div className="card myratings__empty">
          <div className="myratings__empty-orb" aria-hidden="true">
            <Icon name="star" size={28} />
          </div>
          <h2 className="myratings__empty-title">
            {starFilter ? `Không có đánh giá ${starFilter} sao nào` : 'Bạn chưa đánh giá tour nào'}
          </h2>
          <p className="myratings__empty-desc">
            {starFilter
              ? 'Thử chọn mức sao khác hoặc xem toàn bộ đánh giá của bạn.'
              : 'Sau khi trải nghiệm một tour, bạn có thể để lại số sao và nhận xét để giúp cộng đồng khám phá tốt hơn.'}
          </p>
          {starFilter ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setStarFilter(0)}>
              Xem tất cả đánh giá
            </button>
          ) : (
            <Link className="btn btn--primary btn--sm" to="/">
              Khám phá tour ngay
            </Link>
          )}
        </div>
      ) : (
        <>
          <ul className="myratings__list" aria-label="Danh sách đánh giá của tôi">
            {visibleItems.map((r) => {
              const isPublic = r.tour?.status === 'public';
              const tourTitle = r.tour?.title || 'Tour không còn khả dụng';
              const isEditing = editingId === r.id;
              const wasEdited = r.updatedAt && r.createdAt && r.updatedAt !== r.createdAt;

              return (
                <li key={r.id} className="card myrating-card" data-testid="my-rating-card">
                  <div className="myrating-card__head">
                    <div className="myrating-card__thumb" aria-hidden="true">
                      {r.tour?.coverImageUrl ? (
                        <img src={r.tour.coverImageUrl} alt="" loading="lazy" />
                      ) : (
                        <Icon name="headphones" size={20} />
                      )}
                    </div>
                    <div className="myrating-card__tour">
                      {isPublic ? (
                        <Link className="myrating-card__title" to={`/tour/${r.tourId}#ratings`}>
                          {tourTitle}
                        </Link>
                      ) : (
                        <span className="myrating-card__title">{tourTitle}</span>
                      )}
                      <div className="myrating-card__meta muted small">
                        {r.tour?.city ? <span>{r.tour.city}</span> : null}
                        {!isPublic ? <span className="myrating-card__tag">Không còn công khai</span> : null}
                      </div>
                    </div>
                    <div className="myrating-card__score">
                      <Stars value={r.stars} size={15} />
                      <span className="myrating-card__badge">{r.stars}/5</span>
                    </div>
                  </div>

                  {isEditing ? (
                    <InlineEditForm
                      item={r}
                      busy={saveBusy}
                      error={saveError}
                      onSave={handleSave}
                      onCancel={() => {
                        setSaveError('');
                        setEditingId(null);
                      }}
                    />
                  ) : (
                    <>
                      {r.comment ? (
                        <p className="myrating-card__comment">{r.comment}</p>
                      ) : (
                        <p className="muted small myrating-card__nocomment">Không có nhận xét.</p>
                      )}

                      <div className="myrating-card__foot">
                        <span className="muted small myrating-card__time">
                          <Icon name="clock" size={12} />
                          <time dateTime={r.updatedAt || r.createdAt}>
                            {formatDateTime(r.updatedAt || r.createdAt)}
                          </time>
                          {wasEdited ? ' · đã sửa' : ''}
                        </span>
                        <div className="myrating-card__actions">
                          {isPublic ? (
                            <Link className="btn btn--ghost btn--sm" to={`/tour/${r.tourId}#ratings`}>
                              <Icon name="eye" size={14} /> Xem tour
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={deleteBusy}
                            onClick={() => {
                              setSaveError('');
                              setEditingId(r.id);
                            }}
                          >
                            <Icon name="edit" size={14} /> Sửa
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={deleteBusy}
                            onClick={() => setDeleteTarget(r)}
                          >
                            <Icon name="trash" size={14} /> Xoá
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {moreError ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>{moreError}</div>
              <button className="btn btn--sm" onClick={loadMore}>Thử lại</button>
            </div>
          ) : null}

          {items.length < total && !moreError ? (
            <button type="button" className="btn btn--ghost btn--block" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Icon name="loader" size={16} className="spin" /> : null}
              Xem thêm
            </button>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title="Xoá đánh giá của bạn?"
        message="Số sao và nhận xét của bạn sẽ bị xoá khỏi tour này."
        confirmLabel="Xoá"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
