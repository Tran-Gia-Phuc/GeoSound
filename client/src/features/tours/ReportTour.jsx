// =========================================================
// ReportTour (UC06, #268: #106 submit, #164 already reported, #165 "Khác" needs a note).
//   - A small "Báo cáo" entry (tour detail) or icon button (player topbar) opens a dialog.
//   - Guest: prompt to sign in; after sign-in (?report=1) the dialog opens again.
//   - Author (authorId in the detail): no entry; otherwise a 403 own_tour shows the API message.
//   - Already reported (reports/mine or a 409 already_reported): date and reason, no form.
//   - Validation without a request: reason required, note required for "Khác".
//   - The draft (reason + note) is kept in sessionStorage until the report is sent.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatDateTime } from '../../lib/format.js';
import { REPORT_NOTE_MAX, REPORT_REASONS, reportReasonLabel, getMyReport, reportTour } from '../../lib/reports.js';
import './report.css';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const REASON_REQUIRED = 'Vui lòng chọn lý do báo cáo';
const NOTE_REQUIRED = 'Vui lòng mô tả lý do';
const REOPEN_PARAM = 'report';

const errorMessage = (err, fallback) => (err?.offline ? OFFLINE_MESSAGE : err?.message || fallback);
const draftKey = (tourId) => `geosound:report-draft:${tourId}`;

function readDraft(tourId) {
  try {
    const d = JSON.parse(sessionStorage.getItem(draftKey(tourId)) || 'null');
    return d && typeof d === 'object' ? { reason: String(d.reason || ''), note: String(d.note || '') } : null;
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

function ReportForm({ tourId, busy, submitError, onSubmit, onCancel }) {
  const [draft] = useState(() => readDraft(tourId));
  const [reason, setReason] = useState(draft?.reason || '');
  const [note, setNote] = useState(draft?.note || '');
  const [reasonError, setReasonError] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const isOther = reason === 'other';

  useEffect(() => {
    writeDraft(tourId, reason || note ? { reason, note } : null);
  }, [tourId, reason, note]);

  function submit(e) {
    e.preventDefault();
    const missingReason = !reason;
    const missingNote = isOther && !note.trim();
    setReasonError(missingReason);
    setNoteError(missingNote);
    if (missingReason || missingNote) return;
    onSubmit({ reason, note });
  }

  return (
    <form className="report-form" onSubmit={submit} noValidate>
      <p className="muted small">
        Báo cáo giúp quản trị viên xem xét nội dung. Tour không bị ẩn ngay khi bạn gửi.
      </p>
      <fieldset
        className="report-reasons"
        role="radiogroup"
        aria-labelledby="report-reason-label"
        aria-required="true"
        aria-invalid={reasonError || undefined}
        aria-describedby={reasonError ? 'report-reason-err' : undefined}
      >
        <legend id="report-reason-label" className="field__label">Lý do báo cáo</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r.value} className={`report-reason ${reason === r.value ? 'report-reason--on' : ''}`}>
            <input
              type="radio"
              name={`report-reason-${tourId}`}
              value={r.value}
              checked={reason === r.value}
              onChange={() => {
                setReason(r.value);
                setReasonError(false);
                if (r.value !== 'other') setNoteError(false);
              }}
            />
            <span>{r.label}</span>
          </label>
        ))}
        {reasonError ? (
          <p id="report-reason-err" className="field__err" role="alert">{REASON_REQUIRED}</p>
        ) : null}
      </fieldset>

      <label className="field">
        <span className="field__label">{isOther ? 'Mô tả lý do (bắt buộc)' : 'Mô tả thêm (không bắt buộc)'}</span>
        <textarea
          className="input report-form__note"
          rows={3}
          maxLength={REPORT_NOTE_MAX}
          value={note}
          required={isOther}
          aria-invalid={noteError || undefined}
          aria-describedby={`report-note-count${noteError ? ' report-note-err' : ''}`}
          onChange={(e) => {
            setNote(e.target.value);
            if (e.target.value.trim()) setNoteError(false);
          }}
          placeholder={isOther ? 'Cho chúng tôi biết vấn đề của tour này' : 'Chi tiết giúp quản trị viên xử lý nhanh hơn'}
        />
        {noteError ? (
          <span id="report-note-err" className="field__err" role="alert">{NOTE_REQUIRED}</span>
        ) : null}
        <span id="report-note-count" className="field__hint report-form__count">
          {note.length}/{REPORT_NOTE_MAX}
        </span>
      </label>

      {submitError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{submitError}</div>
        </div>
      ) : null}

      <div className="report-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>Huỷ</button>
        <button type="submit" className="btn btn--danger" disabled={busy}>
          {busy ? <Icon name="loader" size={16} className="spin" /> : null} Gửi báo cáo
        </button>
      </div>
    </form>
  );
}

/**
 * @param {{ tour: { id: string, authorId?: string }, variant?: 'detail' | 'player' }} props
 */
export default function ReportTour({ tour, variant = 'detail' }) {
  const tourId = tour.id;
  const toast = useToast();
  const location = useLocation();
  const [sp, setSp] = useSearchParams();
  const { authenticated, user } = useAuth();
  const isAuthor = !!(tour.authorId && user?.id && user.id === tour.authorId);

  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState(undefined); // undefined = loading, null = none, object = already reported
  const [mineError, setMineError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [ownTour, setOwnTour] = useState(null); // 403 own_tour message

  const loadMine = useCallback(async () => {
    setMine(undefined);
    setMineError(null);
    try {
      setMine(await getMyReport(tourId));
    } catch (e) {
      setMineError(errorMessage(e, 'Chưa kiểm tra được trạng thái báo cáo'));
    }
  }, [tourId]);

  const openDialog = useCallback(() => {
    setSubmitError(null);
    setOpen(true);
    if (authenticated && mine === undefined) loadMine();
    else if (authenticated && mineError) loadMine();
  }, [authenticated, mine, mineError, loadMine]);

  // Back from the sign-in page (?report=1): open the dialog again, then drop the parameter.
  const reopen = sp.get(REOPEN_PARAM) === '1';
  useEffect(() => {
    if (!reopen || !authenticated) return;
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete(REOPEN_PARAM);
        return n;
      },
      { replace: true },
    );
    if (!isAuthor) openDialog();
  }, [reopen, authenticated, isAuthor, setSp, openDialog]);

  if (isAuthor) return null; // R4: the author cannot report their own tour.

  async function submit(draft) {
    setBusy(true);
    setSubmitError(null);
    try {
      const body = await reportTour(tourId, draft);
      writeDraft(tourId, null);
      setMine(body?.report ?? { ...draft, createdAt: null });
      setOpen(false);
      toast.show('Đã gửi báo cáo, cảm ơn bạn');
    } catch (e) {
      if (e?.status === 409 && e?.code === 'already_reported') {
        // Not a success: show the server state (date and reason come from reports/mine only).
        writeDraft(tourId, null);
        try {
          setMine((await getMyReport(tourId)) || { duplicate: true });
        } catch {
          setMine({ duplicate: true });
        }
      } else if (e?.status === 403 && e?.code === 'own_tour') {
        setOwnTour(e.message || 'Bạn không thể báo cáo tour của chính mình');
      } else {
        setSubmitError(errorMessage(e, 'Chưa gửi được báo cáo'));
      }
    } finally {
      setBusy(false);
    }
  }

  const sep = location.search ? '&' : '?';
  const loginHref = `/login?next=${encodeURIComponent(`${location.pathname}${location.search}${sep}${REOPEN_PARAM}=1`)}`;
  const close = () => setOpen(false);

  let body;
  if (!authenticated) {
    body = (
      <div className="report-state">
        <p>Bạn cần đăng nhập để báo cáo tour này.</p>
        <div className="report-form__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>Để sau</button>
          <Link className="btn btn--primary" to={loginHref}>Đăng nhập để báo cáo</Link>
        </div>
      </div>
    );
  } else if (ownTour) {
    body = (
      <div className="report-state">
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{ownTour}</div>
        </div>
        <div className="report-form__actions">
          <button type="button" className="btn btn--primary" onClick={close}>Quay lại tour</button>
        </div>
      </div>
    );
  } else if (mineError) {
    body = (
      <div className="alert alert--warn" role="alert">
        <Icon name={mineError === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
        <div>{mineError}</div>
        <button className="btn btn--sm" onClick={loadMine}>Thử lại</button>
      </div>
    );
  } else if (mine === undefined) {
    body = (
      <p className="muted small"><Icon name="loader" size={16} className="spin" /> Đang kiểm tra…</p>
    );
  } else if (mine) {
    body = (
      <div className="report-state" data-testid="report-done">
        <div className="report-state__head">
          <Icon name="check-circle" size={22} className="report-state__icon" />
          <b>Bạn đã báo cáo tour này</b>
        </div>
        {mine.createdAt ? (
          <p className="muted small">
            Gửi lúc <time dateTime={mine.createdAt}>{formatDateTime(mine.createdAt)}</time>
          </p>
        ) : null}
        {mine.reason ? <p className="small">Lý do: <b>{reportReasonLabel(mine.reason)}</b></p> : null}
        {mine.note ? <p className="small report-state__note">{mine.note}</p> : null}
        <p className="muted small">Quản trị viên sẽ xem xét báo cáo của bạn.</p>
        <div className="report-form__actions">
          <button type="button" className="btn btn--primary" onClick={close}>Quay lại tour</button>
        </div>
      </div>
    );
  } else {
    body = <ReportForm tourId={tourId} busy={busy} submitError={submitError} onSubmit={submit} onCancel={close} />;
  }

  return (
    <>
      {variant === 'player' ? (
        <button className="iconbtn" onClick={openDialog} aria-label="Báo cáo tour">
          <Icon name="alert-triangle" size={20} />
        </button>
      ) : (
        <button className="linkbtn report-entry" onClick={openDialog}>
          <Icon name="alert-triangle" size={13} /> Báo cáo
        </button>
      )}
      <Modal open={open} onClose={close} title="Báo cáo tour" labelledBy="report-title">
        {body}
      </Modal>
    </>
  );
}
