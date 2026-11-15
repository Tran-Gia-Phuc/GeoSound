// =========================================================
// UnlockTourPage (/tour/:tourId/unlock) — UC14 tester: enter the passcode the
// author shared to open a tour in restricted mode (signed in; RequireAuth).
//   - GET access/mine first: already unlocked (or the owner) -> straight to the
//     restricted view; 404 -> the tour is not (or no longer) restricted.
//   - Wrong code (403) -> "Mã truy cập không đúng" on the field.
//   - Too many tries (429) -> server message, try again later.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { getMyTourAccess, restrictedPath, unlockTour, validatePasscode } from '../../lib/restricted-access.js';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const errorMessage = (e, fallback) => (e?.offline ? OFFLINE_MESSAGE : e?.message || fallback);

export default function UnlockTourPage() {
  const { tourId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [check, setCheck] = useState({ state: 'loading' }); // loading | locked | unlocked | missing | error
  const [passcode, setPasscode] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setCheck({ state: 'loading' });
    try {
      setCheck({ state: (await getMyTourAccess(tourId)) ? 'unlocked' : 'locked' });
    } catch (e) {
      if (e?.status === 404) setCheck({ state: 'missing', message: e.message });
      else setCheck({ state: 'error', message: errorMessage(e, 'Chưa kiểm tra được quyền truy cập') });
    }
  }, [tourId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(e) {
    e.preventDefault();
    const invalid = validatePasscode(passcode);
    setFormError('');
    setFieldError(invalid);
    if (invalid) return;
    setBusy(true);
    try {
      await unlockTour(tourId, passcode);
      navigate(restrictedPath(tourId), { replace: true });
    } catch (err) {
      if (err?.status === 403) setFieldError(err.message || 'Mã truy cập không đúng');
      else if (err?.status === 404) setCheck({ state: 'missing', message: err.message });
      else if (err?.status === 400) setFieldError(err.message);
      else setFormError(errorMessage(err, 'Chưa mở khoá được tour'));
    } finally {
      setBusy(false);
    }
  }

  if (check.state === 'unlocked') return <Navigate to={restrictedPath(tourId)} replace />;

  return (
    <div className="page page--narrow unlock">
      <AppHeader title="Tour truy cập hạn chế" backTo="/" />

      {check.state === 'loading' ? (
        <p className="muted unlock__loading"><Icon name="loader" size={18} className="spin" /> Đang kiểm tra…</p>
      ) : check.state === 'error' ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={check.message === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{check.message}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : check.state === 'missing' ? (
        <div className="card unlock__card">
          <Icon name="alert-triangle" size={32} />
          <b>{check.message || 'Tour không tồn tại hoặc không ở chế độ truy cập hạn chế'}</b>
          <p className="muted small">Có thể tác giả đã tắt chế độ thử nghiệm hoặc đã xuất bản tour.</p>
          <Link className="btn btn--ghost" to="/">Về Khám phá</Link>
        </div>
      ) : (
        <form className="card unlock__card" onSubmit={onSubmit} noValidate>
          <Icon name="eye-off" size={32} />
          <b>Nhập mã truy cập để nghe thử tour</b>
          <p className="muted small">
            Tour này chưa công khai. Tác giả đã chia sẻ cho bạn một mã truy cập; bạn chỉ cần nhập một lần.
          </p>
          {location.state?.lost ? (
            <div className="alert" role="status">
              <Icon name="info" size={18} className="alert__icon" />
              <div>Mã truy cập đã thay đổi. Hãy nhập mã mới từ tác giả.</div>
            </div>
          ) : null}
          <label className="field unlock__field">
            <span className="field__label">Mã truy cập</span>
            <input
              className="input"
              name="passcode"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={passcode}
              aria-invalid={!!fieldError}
              aria-describedby={fieldError ? 'passcode-error' : undefined}
              onChange={(e) => {
                setPasscode(e.target.value);
                setFieldError('');
              }}
            />
            {fieldError ? (
              <span className="field__err" id="passcode-error" role="alert">{fieldError}</span>
            ) : null}
          </label>
          {formError ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>{formError}</div>
            </div>
          ) : null}
          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? <Icon name="loader" size={18} className="spin" /> : <Icon name="headphones" size={18} />} Mở khoá
          </button>
        </form>
      )}
    </div>
  );
}
