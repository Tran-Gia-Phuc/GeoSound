// =========================================================
// ForgotPasswordPage — Quên mật khẩu (UC01 A2), 2 bước:
//   1) nhập email → máy chủ gửi OTP (luôn trả lời chung chung, không lộ email)
//   2) OTP + mật khẩu mới (hiện/ẩn, đếm ngược hạn mã, gửi lại sau 30 giây)
// Đặt lại xong thì đăng nhập luôn và điều hướng như đăng nhập thường.
// =========================================================
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { useCountdown, formatCountdown } from '../../hooks/useCountdown.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Field, PasswordField, ErrorAlert } from './fields.jsx';
import { destinationFor } from './redirect.js';

const RESEND_LOCK_S = 30;

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const { isDark, toggle } = useTheme();
  const { forgotPassword, resetPasswordAndLogin, resendOtp } = useAuth();

  const [step, setStep] = useState('email'); // email | reset
  const [form, setForm] = useState({ email: '', otp: '', newPassword: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [otpLeft, restartOtp] = useCountdown(0);
  const [resendLeft, restartResend] = useCountdown(0);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function go(fn) {
    setBusy(true);
    setServerError('');
    try {
      await fn();
    } catch (err) {
      if (err?.details && typeof err.details === 'object') setErrors((p) => ({ ...p, ...err.details }));
      setServerError(err?.message || 'Có lỗi xảy ra, vui lòng thử lại');
    } finally {
      setBusy(false);
    }
  }

  const onSend = (e) => {
    e.preventDefault();
    if (!form.email.trim()) {
      setErrors({ email: 'Vui lòng nhập email' });
      return;
    }
    setErrors({});
    go(async () => {
      const res = await forgotPassword({ email: form.email.trim() });
      setStep('reset');
      restartOtp(res?.otpTtlSeconds || 120);
      restartResend(RESEND_LOCK_S);
      setNotice(`Nếu ${form.email.trim()} đã đăng ký, mã OTP đặt lại mật khẩu đã được gửi tới email này.`);
    });
  };

  const onReset = (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.otp.trim()) errs.otp = 'Vui lòng nhập mã OTP';
    if (!form.newPassword) errs.newPassword = 'Vui lòng nhập mật khẩu mới';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    go(async () => {
      const user = await resetPasswordAndLogin({
        email: form.email.trim(),
        otp: form.otp.trim(),
        newPassword: form.newPassword,
      });
      navigate(destinationFor(user, next), { replace: true });
    });
  };

  const onResend = () =>
    go(async () => {
      const res = await resendOtp({ email: form.email.trim(), purpose: 'reset' });
      restartOtp(res?.otpTtlSeconds || 120);
      restartResend(RESEND_LOCK_S);
      setNotice('Đã gửi lại mã OTP.');
    });

  const loginHref = `/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <div className="screen auth">
      <header className="auth__top">
        <Link to="/" className="brand" aria-label="Về trang chủ GeoSound">
          <span className="brand__logo"><Icon name="headphones" size={20} /></span>
          <span className="brand__name">GeoSound</span>
        </Link>
        <button className="iconbtn" onClick={toggle} aria-label="Đổi giao diện sáng/tối">
          <Icon name={isDark ? 'sun' : 'moon'} size={18} />
        </button>
      </header>

      <main className="auth__main">
        <div className="auth__card">
          {step === 'email' ? (
            <Link className="linkbtn auth__back" to={loginHref}>
              <Icon name="arrow-left" size={16} /> Đăng nhập
            </Link>
          ) : (
            <button className="linkbtn auth__back" onClick={() => setStep('email')}>
              <Icon name="arrow-left" size={16} /> Đổi email
            </button>
          )}
          <h1 className="auth__h1">{step === 'email' ? 'Quên mật khẩu' : 'Đặt mật khẩu mới'}</h1>
          <p className="muted small">
            {step === 'email'
              ? 'Nhập email đã đăng ký, chúng tôi sẽ gửi mã OTP để đặt lại mật khẩu.'
              : 'Nhập mã OTP trong email và mật khẩu mới của bạn.'}
          </p>

          {notice && step === 'reset' ? <p className="auth__notice" role="status">{notice}</p> : null}
          <ErrorAlert>{serverError}</ErrorAlert>

          {step === 'email' ? (
            <form className="auth__form" onSubmit={onSend} noValidate>
              <Field
                id="email"
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="ban@email.com"
                value={form.email}
                onChange={set('email')}
                error={errors.email}
              />
              <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
                {busy ? <Icon name="loader" size={18} className="spin" /> : null}
                Gửi mã OTP
              </button>
            </form>
          ) : (
            <>
              <form className="auth__form" onSubmit={onReset} noValidate>
                <Field
                  id="otp"
                  label="Mã OTP"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="______"
                  value={form.otp}
                  onChange={set('otp')}
                  error={errors.otp}
                  hint={otpLeft ? `Mã còn hiệu lực ${formatCountdown(otpLeft)}` : 'Mã đã hết hạn — hãy gửi lại mã mới.'}
                />
                <PasswordField
                  id="newPassword"
                  label="Mật khẩu mới"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={form.newPassword}
                  onChange={set('newPassword')}
                  error={errors.newPassword}
                  hint="Tối thiểu 8 ký tự, có chữ và số."
                />
                <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
                  {busy ? <Icon name="loader" size={18} className="spin" /> : null}
                  Đặt lại & đăng nhập
                </button>
              </form>
              <button className="linkbtn auth__resend" onClick={onResend} disabled={busy || resendLeft > 0}>
                {resendLeft > 0 ? `Gửi lại mã sau ${resendLeft} giây` : 'Gửi lại mã OTP'}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
