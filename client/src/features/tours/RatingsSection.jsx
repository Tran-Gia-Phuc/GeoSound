// =========================================================
// RatingsSection (UC05, #267: #105 submit, #162 edit/delete, #163 missing star).
//   - Summary: average, count, star distribution bars (from the rating rows).
//   - My rating: guest -> "Đăng nhập để đánh giá" (login with next); author -> no form;
//     signed in -> 1..5 star radio group + optional comment (max 1000) -> "Gửi đánh giá";
//     an existing rating is shown with "Sửa" and "Xoá" (ConfirmDialog).
//   - Missing star: inline error, no API call; the draft is kept (also in sessionStorage,
//     so it survives a sign-in when the session expired).
//   - Comment list: newest first, paged with "Xem thêm".
//   - After a change the summary comes from the API response (no full reload).
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatDateTime } from '../../lib/format.js';
import {
  RATING_COMMENT_MAX,
  listRatings,
  getMyRating,
  saveMyRating,
  deleteMyRating,
} from '../../lib/ratings.js';
import './ratings.css';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const STARS_REQUIRED = 'Vui lòng chọn số sao';
const STAR_VALUES = [1, 2, 3, 4, 5];

const errorMessage = (err, fallback) => (err?.offline ? OFFLINE_MESSAGE : err?.message || fallback);
const formatAverage = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1).replace('.', ',') : '0,0');
const draftKey = (tourId) => `geosound:rating-draft:${tourId}`;

function readDraft(tourId) {
  try {
    const d = JSON.parse(sessionStorage.getItem(draftKey(tourId)) || 'null');
    return d && typeof d === 'object' ? { stars: Number(d.stars) || 0, comment: String(d.comment || '') } : null;
  } catch {
    return null;
  }
}
function writeDraft(tourId, draft) {
  try {
    if (draft) sessionStorage.setItem(draftKey(tourId), JSON.stringify(draft));
    else sessionStorage.removeItem(draftKey(tourId));
  } catch {
    /* storage unavailable: the draft only lives in memory */
  }
}

/** Read-only row of 5 stars. */
function Stars({ value, size = 14 }) {
  return (
    <span className="rv-stars" role="img" aria-label={`${value} trên 5 sao`}>
      {STAR_VALUES.map((n) => (
        <Icon key={n} name="star" size={size} className={n <= value ? 'rv-star rv-star--on' : 'rv-star'} />
      ))}
    </span>
  );
}

function Summary({ summary }) {
  const dist = summary.distribution || {};
  const rows = STAR_VALUES.reduce((sum, n) => sum + (Number(dist[n]) || 0), 0);
  return (
    <div className="rv-summary" data-testid="rating-summary">
      <div className="rv-summary__avg">
        <b className="rv-summary__value">{formatAverage(summary.averageRating)}</b>
        <Stars value={Math.round(Number(summary.averageRating) || 0)} size={16} />
        <span className="muted small">{summary.ratingCount || 0} lượt đánh giá</span>
      </div>
      <ul className="rv-dist" aria-label="Phân bố số sao">
        {[...STAR_VALUES].reverse().map((n) => {
          const count = Number(dist[n]) || 0;
          const pct = rows ? Math.round((count / rows) * 100) : 0;
          return (
            <li key={n} className="rv-dist__row" aria-label={`${n} sao: ${count} lượt`}>
              <span className="rv-dist__label" aria-hidden="true">{n}<Icon name="star" size={11} className="rv-star rv-star--on" /></span>
              <span className="rv-dist__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
              <span className="rv-dist__count muted small" aria-hidden="true">{count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Star radio group + comment; keeps its draft until a successful save. */
function RatingForm({ tourId, initial, busy, submitError, onSubmit, onCancel }) {
  const [stars, setStars] = useState(initial?.stars || 0);
  const [comment, setComment] = useState(initial?.comment || '');
  const [starsError, setStarsError] = useState(false);
  const editing = !!onCancel;

  useEffect(() => {
    if (!editing) writeDraft(tourId, stars || comment ? { stars, comment } : null);
  }, [tourId, stars, comment, editing]);

  function submit(e) {
    e.preventDefault();
    if (!stars) {
      setStarsError(true);
      return;
    }
    onSubmit({ stars, comment });
  }

  return (
    <form className="rv-form card" onSubmit={submit} noValidate aria-label={editing ? 'Sửa đánh giá' : 'Đánh giá tour'}>
      <div
        className="rv-picker"
        role="radiogroup"
        aria-labelledby="rv-picker-label"
        aria-required="true"
        aria-invalid={starsError || undefined}
        aria-describedby={starsError ? 'rv-stars-err' : undefined}
      >
        <span id="rv-picker-label" className="field__label">Số sao</span>
        <div className="rv-picker__stars">
          {STAR_VALUES.map((n) => (
            <label key={n} className={`rv-picker__star ${n <= stars ? 'rv-picker__star--on' : ''}`}>
              <input
                type="radio"
                name={`rv-stars-${tourId}`}
                value={n}
                checked={stars === n}
                aria-label={`${n} sao`}
                onChange={() => {
                  setStars(n);
                  setStarsError(false);
                }}
              />
              <Icon name="star" size={28} />
            </label>
          ))}
        </div>
        {starsError ? (
          <p id="rv-stars-err" className="field__err" role="alert">{STARS_REQUIRED}</p>
        ) : null}
      </div>

      <label className="field">
        <span className="field__label">Nhận xét (không bắt buộc)</span>
        <textarea
          className="input rv-form__comment"
          rows={3}
          maxLength={RATING_COMMENT_MAX}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Chia sẻ cảm nhận của bạn về tour"
          aria-describedby="rv-comment-count"
        />
        <span id="rv-comment-count" className="field__hint rv-form__count">
          {comment.length}/{RATING_COMMENT_MAX}
        </span>
      </label>

      {submitError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{submitError}</div>
        </div>
      ) : null}

      <div className="rv-form__actions">
        {editing ? (
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>Huỷ</button>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? <Icon name="loader" size={16} className="spin" /> : null}
          {editing ? 'Lưu thay đổi' : 'Gửi đánh giá'}
        </button>
      </div>
    </form>
  );
}

/**
 * @param {{ tour: { id: string, authorId?: string, averageRating?: number, ratingCount?: number },
 *           onSummary?: (s: { averageRating: number, ratingCount: number }) => void }} props
 */
export default function RatingsSection({ tour, onSummary }) {
  const tourId = tour.id;
  const toast = useToast();
  const location = useLocation();
  const { authenticated, user } = useAuth();
  const isAuthor = !!(tour.authorId && user?.id && user.id === tour.authorId);

  const [list, setList] = useState(null); // { summary, items, page, total } | null = loading
  const [listError, setListError] = useState(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState(null);

  const [mine, setMine] = useState(undefined); // undefined = loading, null = none
  const [mineError, setMineError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [ownTour, setOwnTour] = useState(null); // 403 own_tour message
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sectionRef = useRef(null);
  const onSummaryRef = useRef(onSummary);
  onSummaryRef.current = onSummary;

  const loadList = useCallback(async () => {
    setListError(null);
    try {
      const body = await listRatings(tourId, { page: 1 });
      setList({ summary: body.summary, items: body.items || [], page: body.page || 1, total: body.total || 0 });
    } catch (e) {
      setListError(errorMessage(e, 'Chưa tải được đánh giá'));
    }
  }, [tourId]);

  const loadMine = useCallback(async () => {
    if (!authenticated || isAuthor) {
      setMine(null);
      return;
    }
    setMine(undefined);
    setMineError(null);
    try {
      setMine(await getMyRating(tourId));
    } catch (e) {
      setMineError(errorMessage(e, 'Chưa tải được đánh giá của bạn'));
    }
  }, [tourId, authenticated, isAuthor]);

  useEffect(() => {
    loadList();
  }, [loadList]);
  useEffect(() => {
    loadMine();
  }, [loadMine]);

  // Opened from the player end screen or a sign-in redirect: /tour/:id#ratings.
  useEffect(() => {
    if (location.hash === '#ratings') sectionRef.current?.scrollIntoView?.({ block: 'start' });
  }, [location.hash]);

  async function loadMore() {
    if (!list) return;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const body = await listRatings(tourId, { page: list.page + 1 });
      setList((cur) => {
        const seen = new Set(cur.items.map((r) => r.id));
        return {
          ...cur,
          items: [...cur.items, ...(body.items || []).filter((r) => !seen.has(r.id))],
          page: body.page || cur.page + 1,
          total: body.total ?? cur.total,
        };
      });
    } catch (e) {
      setMoreError(errorMessage(e, 'Chưa tải thêm được đánh giá'));
    } finally {
      setMoreBusy(false);
    }
  }

  /** Applies a change of my rating to the summary and the loaded list (no reload). */
  function applyChange(previous, next, summary) {
    setList((cur) => {
      if (!cur) return cur;
      const distribution = { ...(cur.summary?.distribution || {}) };
      if (previous) distribution[previous.stars] = Math.max(0, (Number(distribution[previous.stars]) || 0) - 1);
      if (next) distribution[next.stars] = (Number(distribution[next.stars]) || 0) + 1;
      let items = cur.items;
      let total = cur.total;
      if (next && previous && items.some((r) => r.id === next.id)) items = items.map((r) => (r.id === next.id ? next : r));
      else if (next && !previous) {
        items = [next, ...items.filter((r) => r.id !== next.id)];
        total += 1;
      } else if (next) items = [next, ...items.filter((r) => r.id !== previous.id && r.id !== next.id)];
      if (!next && previous) {
        items = items.filter((r) => r.id !== previous.id);
        total = Math.max(0, total - 1);
      }
      return { ...cur, items, total, summary: { ...cur.summary, ...summary, distribution } };
    });
    onSummaryRef.current?.(summary);
  }

  async function save(draft) {
    setBusy(true);
    setSubmitError(null);
    const previous = mine;
    try {
      const body = await saveMyRating(tourId, draft);
      writeDraft(tourId, null);
      setMine(body.rating);
      setEditing(false);
      applyChange(previous, body.rating, body.summary);
      toast.show(previous ? 'Đã cập nhật đánh giá' : 'Cảm ơn đánh giá của bạn');
    } catch (e) {
      if (e?.status === 403 && e?.code === 'own_tour') setOwnTour(e.message || 'Bạn không thể tự đánh giá tour của mình');
      else setSubmitError(errorMessage(e, 'Chưa gửi được đánh giá'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setConfirmDelete(false);
    const previous = mine;
    if (!previous) return;
    setBusy(true);
    try {
      await deleteMyRating(tourId);
    } catch (e) {
      if (e?.status !== 404) {
        toast.show(errorMessage(e, 'Chưa xoá được đánh giá'), { tone: 'danger' });
        setBusy(false);
        return;
      }
      // 404 rating_not_found: already gone, treat as deleted.
    }
    // DELETE answers 204 without a summary: same formula as the server (design note section 3).
    const count = Number(list?.summary?.ratingCount ?? tour.ratingCount) || 0;
    const avg = Number(list?.summary?.averageRating ?? tour.averageRating) || 0;
    const nextCount = Math.max(0, count - 1);
    const summary = {
      ratingCount: nextCount,
      averageRating: nextCount ? (avg * count - previous.stars) / nextCount : 0,
    };
    setMine(null);
    setEditing(false);
    applyChange(previous, null, summary);
    toast.show('Đã xoá đánh giá');
    setBusy(false);
  }

  const loginHref = `/login?next=${encodeURIComponent(`${location.pathname}${location.search}#ratings`)}`;

  let mineBlock;
  if (!authenticated) {
    mineBlock = (
      <Link className="btn btn--primary rv-login" to={loginHref}>
        <Icon name="star" size={16} /> Đăng nhập để đánh giá
      </Link>
    );
  } else if (isAuthor || ownTour) {
    mineBlock = (
      <p className="muted small rv-note" role={ownTour ? 'alert' : undefined}>
        <Icon name="user" size={14} /> {ownTour || 'Bạn là tác giả của tour này nên không thể tự đánh giá.'}
      </p>
    );
  } else if (mineError) {
    mineBlock = (
      <div className="alert alert--warn" role="alert">
        <Icon name={mineError === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
        <div>{mineError}</div>
        <button className="btn btn--sm" onClick={loadMine}>Thử lại</button>
      </div>
    );
  } else if (mine === undefined) {
    mineBlock = (
      <p className="muted small"><Icon name="loader" size={16} className="spin" /> Đang tải đánh giá của bạn…</p>
    );
  } else if (mine && !editing) {
    mineBlock = (
      <div className="card rv-mine" data-testid="my-rating">
        <div className="rv-mine__head">
          <b>Đánh giá của bạn</b>
          <Stars value={mine.stars} size={16} />
        </div>
        {mine.comment ? <p className="rv-item__text">{mine.comment}</p> : <p className="muted small">Không có nhận xét.</p>}
        <div className="rv-form__actions">
          <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { setSubmitError(null); setEditing(true); }}>
            <Icon name="edit" size={14} /> Sửa
          </button>
          <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={14} /> Xoá
          </button>
        </div>
      </div>
    );
  } else {
    mineBlock = (
      <RatingForm
        key={mine ? `edit-${mine.id}` : 'new'}
        tourId={tourId}
        initial={mine ? { stars: mine.stars, comment: mine.comment || '' } : readDraft(tourId)}
        busy={busy}
        submitError={submitError}
        onSubmit={save}
        onCancel={mine ? () => { setSubmitError(null); setEditing(false); } : undefined}
      />
    );
  }

  const items = list?.items || [];

  return (
    <section className="detail__section rv" id="ratings" ref={sectionRef} aria-labelledby="rev-h">
      <h2 className="detail__h2" id="rev-h">Đánh giá</h2>

      {list ? <Summary summary={list.summary || { averageRating: tour.averageRating, ratingCount: tour.ratingCount }} /> : null}

      {mineBlock}

      {listError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={listError === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{listError}</div>
          <button className="btn btn--sm" onClick={loadList}>Thử lại</button>
        </div>
      ) : list === null ? (
        <p className="muted small"><Icon name="loader" size={16} className="spin" /> Đang tải đánh giá…</p>
      ) : items.length === 0 ? (
        <p className="muted small rv-empty">Chưa có nhận xét nào. Hãy là người đầu tiên đánh giá tour này.</p>
      ) : (
        <>
          <ul className="rv-list" aria-label="Nhận xét của người nghe">
            {items.map((r) => (
              <li key={r.id} className="rv-item" data-testid="rating-item">
                <div className="rv-item__head">
                  <b className="rv-item__name">{r.userName || 'Người dùng GeoSound'}</b>
                  <Stars value={r.stars} />
                </div>
                <span className="muted small">
                  <time dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
                  {r.updatedAt && r.updatedAt !== r.createdAt ? ' · đã sửa' : ''}
                </span>
                {r.comment ? <p className="rv-item__text">{r.comment}</p> : null}
              </li>
            ))}
          </ul>
          {moreError ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>{moreError}</div>
            </div>
          ) : null}
          {items.length < list.total ? (
            <button className="btn btn--ghost loadmore" onClick={loadMore} disabled={moreBusy}>
              {moreBusy ? <Icon name="loader" size={16} className="spin" /> : null} Xem thêm
            </button>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        danger
        title="Xoá đánh giá của bạn?"
        message="Số sao và nhận xét của bạn sẽ bị xoá khỏi tour này."
        confirmLabel="Xoá"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
}

