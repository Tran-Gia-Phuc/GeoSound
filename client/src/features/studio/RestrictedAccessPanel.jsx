// =========================================================
// RestrictedAccessPanel (UC14, #107) — Studio, publish step: "Truy cập hạn chế".
// The author lets a few signed-in testers open a tour that is not public, with a
// passcode (no admin review).
//   - Off: passcode (6–32, no spaces) + "Bật truy cập hạn chế" (PUT).
//     409 tour_not_restrictable (public tour, tour in moderation) is shown as is.
//   - On : since when, testers count, link to share, open the tester view,
//     change the passcode (testers must enter the new one), turn off (ConfirmDialog,
//     DELETE -> tour back to Nháp, testers lose access).
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatDateTime } from '../../lib/format.js';
import {
  disableTourAccess,
  getTourAccess,
  restrictedPath,
  setTourPasscode,
  unlockPath,
  validatePasscode,
} from '../../lib/restricted-access.js';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const errorMessage = (e, fallback) => (e?.offline ? OFFLINE_MESSAGE : e?.message || fallback);
const RESTRICTABLE = ['draft', 'rejected', 'changes_requested'];

/**
 * @param {{ tourId: string, status: string, onChanged: (tour?: object) => void }} props
 * onChanged: the tour status changed (on / off) — the layout reloads the tour.
 */
export default function RestrictedAccessPanel({ tourId, status, onChanged }) {
  const toast = useToast();
  const [access, setAccess] = useState(null); // null = loading
  const [loadError, setLoadError] = useState('');
  const [passcode, setPasscode] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setAccess(await getTourAccess(tourId));
    } catch (e) {
      setLoadError(errorMessage(e, 'Chưa tải được trạng thái truy cập hạn chế'));
    }
  }, [tourId]);

  useEffect(() => {
    load();
  }, [load, status]);

  async function onSave(e) {
    e.preventDefault();
    const invalid = validatePasscode(passcode);
    setFieldError(invalid);
    setActionError('');
    if (invalid) return;
    setBusy(true);
    try {
      const res = await setTourPasscode(tourId, passcode);
      setAccess({ restricted: true, passcodeSetAt: res.passcodeSetAt, testers: res.testers ?? 0 });
      setPasscode('');
      setChanging(false);
      if (res.changed === 'passcode') {
        toast.show('Đã đổi mã truy cập. Người thử cần nhập mã mới.');
      } else {
        toast.show('Đã bật truy cập hạn chế');
        onChanged?.();
      }
    } catch (err) {
      if (err?.status === 400) setFieldError(err.message);
      else setActionError(errorMessage(err, 'Chưa lưu được mã truy cập'));
    } finally {
      setBusy(false);
    }
  }

  async function onTurnOff() {
    setConfirmOff(false);
    setBusy(true);
    setActionError('');
    try {
      const tour = await disableTourAccess(tourId);
      setAccess({ restricted: false, passcodeSetAt: null, testers: 0 });
      setChanging(false);
      toast.show('Đã tắt truy cập hạn chế. Tour đã về Nháp.');
      onChanged?.(tour);
    } catch (err) {
      setActionError(errorMessage(err, 'Chưa tắt được truy cập hạn chế'));
      if (err?.status === 409) load();
    } finally {
      setBusy(false);
    }
  }

  const on = !!access?.restricted;
  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}${unlockPath(tourId)}` : unlockPath(tourId);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.show('Đã sao chép liên kết');
    } catch {
      toast.show('Chưa sao chép được, hãy chọn và sao chép liên kết', { tone: 'danger' });
    }
  }

  const form = (
    <form className="restricted__form" onSubmit={onSave} noValidate>
      <div className="field">
        <label className="field__label" htmlFor="ra-passcode">{on ? 'Mã truy cập mới' : 'Mã truy cập'}</label>
        <input
          id="ra-passcode"
          className="input"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={passcode}
          aria-invalid={!!fieldError}
          aria-describedby={fieldError ? 'ra-passcode-err' : 'ra-passcode-hint'}
          onChange={(e) => {
            setPasscode(e.target.value);
            setFieldError('');
          }}
        />
        {fieldError ? (
          <span id="ra-passcode-err" className="field__err" role="alert">{fieldError}</span>
        ) : (
          <span id="ra-passcode-hint" className="field__hint">Từ 6 đến 32 ký tự, không có khoảng trắng.</span>
        )}
      </div>
      {on ? (
        <div className="alert" role="note">
          <Icon name="info" size={18} className="alert__icon" />
          <div>Sau khi đổi mã, mọi người thử phải nhập mã mới mới mở lại được tour.</div>
        </div>
      ) : null}
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="eye-off" size={16} />}
          {on ? ' Lưu mã mới' : ' Bật truy cập hạn chế'}
        </button>
        {on ? (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setChanging(false); setPasscode(''); setFieldError(''); }}>
            Huỷ
          </button>
        ) : null}
      </div>
    </form>
  );

  return (
    <section className="publish restricted" aria-labelledby="restricted-h">
      <div className="publish__head">
        <h2 className="studio__h2" id="restricted-h">Truy cập hạn chế</h2>
        {access ? <span className={`chip ${on ? 'chip--live' : ''}`}>{on ? 'Đang bật' : 'Đang tắt'}</span> : null}
      </div>

      {loadError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={loadError === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{loadError}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : access === null ? (
        <p className="muted small"><Icon name="loader" size={16} className="spin" /> Đang tải…</p>
      ) : on ? (
        <>
          <p className="muted small">
            Chỉ người có mã mới nghe được tour này; tour không hiện ở Khám phá và không cần quản trị viên duyệt.
          </p>
          <ul className="restricted__facts">
            {access.passcodeSetAt ? (
              <li>
                <Icon name="clock" size={14} /> Đặt mã lúc{' '}
                <time dateTime={access.passcodeSetAt}>{formatDateTime(access.passcodeSetAt)}</time>
              </li>
            ) : null}
            <li><Icon name="user" size={14} /> {access.testers ?? 0} người thử đã mở khoá</li>
          </ul>
          <div className="field">
            <label className="field__label" htmlFor="ra-link">Liên kết gửi cho người thử</label>
            <div className="restricted__link">
              <input id="ra-link" className="input" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn--sm" onClick={copyLink}>
                <Icon name="copy" size={16} /> Sao chép
              </button>
            </div>
          </div>
          {changing ? form : null}
          <div className="publish__actions">
            <Link className="btn" to={restrictedPath(tourId)}>
              <Icon name="headphones" size={16} /> Mở bản người thử thấy
            </Link>
            {changing ? null : (
              <button className="btn btn--ghost" disabled={busy} onClick={() => setChanging(true)}>
                <Icon name="edit" size={16} /> Đổi mã truy cập
              </button>
            )}
            <button className="btn btn--ghost restricted__off" disabled={busy} onClick={() => setConfirmOff(true)}>
              Tắt truy cập hạn chế
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Cho một nhóm nhỏ nghe thử tour trước khi công khai: đặt một mã truy cập rồi gửi mã và liên kết cho họ.
            Tour sẽ không hiện ở Khám phá và không cần quản trị viên duyệt.
          </p>
          {!RESTRICTABLE.includes(status) ? (
            <div className="alert" role="status">
              <Icon name="info" size={18} className="alert__icon" />
              <div>
                {status === 'public'
                  ? 'Tour đang công khai: hãy gỡ xuống trước khi bật truy cập hạn chế.'
                  : 'Chỉ bật được cho tour Nháp, bị từ chối hoặc cần chỉnh sửa.'}
              </div>
            </div>
          ) : null}
          {form}
        </>
      )}

      {actionError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{actionError}</div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOff}
        danger
        title="Tắt truy cập hạn chế?"
        message="Tour sẽ về Nháp và mọi người thử mất quyền nghe. Bạn có thể bật lại với mã mới bất cứ lúc nào."
        confirmLabel="Tắt truy cập"
        onConfirm={onTurnOff}
        onCancel={() => setConfirmOff(false)}
      />
    </section>
  );
}
