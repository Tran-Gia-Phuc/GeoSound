// =========================================================
// LoginPage — Đăng nhập / Đăng ký (UC01 phía client), cửa vào cho UC07/UC08.
// Đăng ký theo 2 bước: nhập thông tin -> nhận OTP qua email -> xác thực -> tự
// đăng nhập. Lỗi hiển thị NGAY tại trường (a11y) + 1 thông báo chung role=alert.
// Sau khi vào được sẽ quay lại ?next=.
// =========================================================
import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { useAuth } from '../../auth/AuthContext.jsx';

function Field({ id, label, hint, error, ...props }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...props}
      />
      {error ? (
        <p id={`${id}-err`} className="field__err" role="alert">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const { isDark, toggle } = useTheme();
  const { login, register, registerAndVerify, resendOtp } = useAuth();

  const [tab, setTab] = useState('login'); // login | register
  const [phase, setPhase] = useState('form'); // register: form | otp
  const [form, setForm] = useState({ fullName: '', email: '', password: '', otp: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const switchTab = (t) => {
    setTab(t);
    setPhase('form');
    setErrors({});
    setServerError('');
    setNotice('');
  };

  // --- validation tối thiểu phía client (chi tiết do server kiểm) ---
  function validate() {
    const e = {};
    if (!form.email.trim()) e.email = 'Vui lòng nhập email';
    if (!form.password) e.password = 'Vui lòng nhập mật khẩu';
    if (tab === 'register' && !form.fullName.trim()) e.fullName = 'Vui lòng nhập họ tên';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function go(fn) {
    setBusy(true);
    setServerError('');
    try {
      await fn();
    } catch (err) {
      // Lỗi xác thực theo trường (nếu server trả details) -> gắn vào field.
      if (err?.details && typeof err.details === 'object') setErrors((p) => ({ ...p, ...err.details }));
      setServerError(err?.message || 'Có lỗi xảy ra, vui lòng thử lại');
    } finally {
      setBusy(false);
    }
  }

  const onLogin = (e) => {
    e.preventDefault();
    if (!validate()) return;
    go(async () => {
      await login({ email: form.email.trim(), password: form.password });
      navigate(next, { replace: true });
    });
  };

  const onRegister = (e) => {
    e.preventDefault();
    if (!validate()) return;
    go(async () => {
      const res = await register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      setPhase('otp');
      setNotice(
        `Đã gửi mã OTP tới ${form.email.trim()}${
          res?.otpTtlSeconds ? ` (hết hạn sau ${Math.round(res.otpTtlSeconds / 60)} phút)` : ''
        }.`,
      );
    });
  };

  const onVerify = (e) => {
    e.preventDefault();
    if (!form.otp.trim()) {
      setErrors({ otp: 'Vui lòng nhập mã OTP' });
      return;
    }
    go(async () => {
      await registerAndVerify({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        otp: form.otp.trim(),
      });
      navigate(next, { replace: true });
    });
  };

  const onResend = () =>
    go(async () => {
      await resendOtp({ email: form.email.trim(), purpose: 'register' });
      setNotice('Đã gửi lại mã OTP.');
    });

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
          {phase === 'otp' ? (
            <>
              <button className="linkbtn auth__back" onClick={() => setPhase('form')}>
                <Icon name="arrow-left" size={16} /> Quay lại
              </button>
              <h1 className="auth__h1">Xác thực email</h1>
              <p className="muted small">Nhập mã OTP gồm 6 số đã gửi tới email của bạn.</p>

              {notice ? <p className="auth__notice" role="status">{notice}</p> : null}
              {serverError ? (
                <div className="alert alert--warn" role="alert">
                  <Icon name="alert-triangle" size={18} className="alert__icon" />
                  <div>{serverError}</div>
                </div>
              ) : null}

              <form className="auth__form" onSubmit={onVerify} noValidate>
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
                />
                <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
                  {busy ? <Icon name="loader" size={18} className="spin" /> : null}
                  Xác thực & đăng nhập
                </button>
              </form>
              <button className="linkbtn auth__resend" onClick={onResend} disabled={busy}>
                Gửi lại mã OTP
              </button>
            </>
          ) : (
            <>
              <div className="auth__tabs" role="tablist" aria-label="Đăng nhập hoặc đăng ký">
                <button
                  role="tab"
                  aria-selected={tab === 'login'}
                  className={`auth__tab ${tab === 'login' ? 'is-active' : ''}`}
                  onClick={() => switchTab('login')}
                >
                  Đăng nhập
                </button>
                <button
                  role="tab"
                  aria-selected={tab === 'register'}
                  className={`auth__tab ${tab === 'register' ? 'is-active' : ''}`}
                  onClick={() => switchTab('register')}
                >
                  Đăng ký
                </button>
              </div>

              <h1 className="auth__h1">
                {tab === 'login' ? 'Chào mừng trở lại' : 'Tạo tài khoản'}
              </h1>
              <p className="muted small">
                {tab === 'login'
                  ? 'Đăng nhập để tạo và đi theo lịch trình cá nhân của bạn.'
                  : 'Đăng ký tài khoản khách du lịch để lưu lịch trình.'}
              </p>

              {serverError ? (
                <div className="alert alert--warn" role="alert">
                  <Icon name="alert-triangle" size={18} className="alert__icon" />
                  <div>{serverError}</div>
                </div>
              ) : null}

              <form className="auth__form" onSubmit={tab === 'login' ? onLogin : onRegister} noValidate>
                {tab === 'register' ? (
                  <Field
                    id="fullName"
                    label="Họ và tên"
                    autoComplete="name"
                    placeholder="Nguyễn Văn A"
                    value={form.fullName}
                    onChange={set('fullName')}
                    error={errors.fullName}
                  />
                ) : null}
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
                <Field
                  id="password"
                  label="Mật khẩu"
                  type="password"
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={set('password')}
                  error={errors.password}
                  hint={tab === 'register' ? 'Tối thiểu 8 ký tự, có chữ và số.' : undefined}
                />
                <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
                  {busy ? <Icon name="loader" size={18} className="spin" /> : null}
                  {tab === 'login' ? 'Đăng nhập' : 'Tiếp tục'}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
