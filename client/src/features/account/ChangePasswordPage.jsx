// =========================================================
// ChangePasswordPage (/account/password) — UC01 / UC23 R6: the signed-in user changes
// their password with POST /api/auth/change-password. This session stays signed in;
// Auth signs out every other device (`revoked` in the answer). Errors: 400 wrong_password
// on the current password field, 400 validation_error on the new password field.
// =========================================================
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { useToast } from '../../components/Toast.jsx';
import { ErrorAlert, PasswordField } from '../auth/fields.jsx';
import { changePassword, newPasswordProblem } from '../../lib/auth.js';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const EMPTY = { currentPassword: '', newPassword: '', confirm: '' };

function validate(form) {
  const errs = {};
  if (!form.currentPassword) errs.currentPassword = 'Vui lòng nhập mật khẩu hiện tại';
  const problem = newPasswordProblem(form.newPassword);
  if (problem) errs.newPassword = problem;
  else if (form.newPassword === form.currentPassword) errs.newPassword = 'Mật khẩu mới phải khác mật khẩu hiện tại';
  if (!errs.newPassword && form.confirm !== form.newPassword) errs.confirm = 'Mật khẩu nhập lại không khớp';
  return errs;
}

export default function ChangePasswordPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((x) => ({ ...x, [key]: undefined }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    setServerError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      const revoked = Number(res?.revoked) || 0;
      toast.show(revoked > 0 ? `Đã đổi mật khẩu. Đã đăng xuất ${revoked} thiết bị khác.` : 'Đã đổi mật khẩu');
      setForm(EMPTY);
      navigate('/account');
    } catch (err) {
      if (err?.code === 'wrong_password') setErrors({ currentPassword: err.message || 'Mật khẩu hiện tại không đúng' });
      else if (err?.status === 400) setErrors({ newPassword: err.message });
      else setServerError(err?.offline ? OFFLINE_MESSAGE : err?.message || 'Chưa đổi được mật khẩu');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page--narrow">
      <AppHeader title="Đổi mật khẩu" backTo="/account" />
      <form className="card studio-form" onSubmit={onSubmit} noValidate>
        <PasswordField
          id="cp-current"
          label="Mật khẩu hiện tại"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={set('currentPassword')}
          error={errors.currentPassword}
        />
        <PasswordField
          id="cp-new"
          label="Mật khẩu mới"
          autoComplete="new-password"
          hint="Tối thiểu 8 ký tự, gồm chữ và số."
          value={form.newPassword}
          onChange={set('newPassword')}
          error={errors.newPassword}
        />
        <PasswordField
          id="cp-confirm"
          label="Nhập lại mật khẩu mới"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
        />
        <p className="muted small">Thiết bị này vẫn đăng nhập; các thiết bị khác sẽ bị đăng xuất.</p>
        <ErrorAlert>{serverError}</ErrorAlert>
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="check-circle" size={16} />} Đổi mật khẩu
          </button>
        </div>
      </form>
    </div>
  );
}
