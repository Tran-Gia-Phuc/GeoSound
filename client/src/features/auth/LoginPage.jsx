// =========================================================
// LoginPage — Đăng nhập / Đăng ký (UC01 phía client).
//   Đăng nhập : email + mật khẩu (hiện/ẩn) · liên kết "Quên mật khẩu?" (A2)
//   Đăng ký   : 1) chọn vai trò (Đi du lịch / Tạo tour audio — A1.2)
//               2) họ tên · email · mật khẩu
//               3) OTP email: đếm ngược hạn mã, "Gửi lại" khoá 30 giây
//   Vào được tài khoản → ?next= nếu có, không thì theo vai trò (bước 6):
//   người đóng góp → Studio, khách → Khám phá.
// Lỗi hiển thị ngay tại trường (a11y) + 1 thông báo chung role=alert.
// =========================================================
import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useCountdown, formatCountdown } from '../../hooks/useCountdown.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Field, PasswordField, ErrorAlert } from './fields.jsx';
import { destinationFor, leadFor } from './redirect.js';
import './login-a.css';

const RESEND_LOCK_S = 30;

const ROLE_OPTIONS = [
  {
    value: 'tourist',
    icon: 'headphones',
    title: 'Tôi đi du lịch',
    desc: 'Nghe tour audio, lưu lịch trình cho chuyến đi.',
  },
  {
    value: 'contributor',
    icon: 'mic',
    title: 'Tôi tạo tour audio',
    desc: 'Soạn điểm dừng, thu giọng thuyết minh, xuất bản tour cho khách.',
  },
];

export default function LoginPage({ initialTab = 'login' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = params.get('next');
  const { login, register, registerAndVerify, resendOtp } = useAuth();

  const presetRole = params.get('role') === 'contributor' || next?.startsWith('/studio') ? 'contributor' : null;

  const [tab, setTab] = useState(initialTab); // login | register
  const [phase, setPhase] = useState('role'); // register: role | form | otp
  const [role, setRole] = useState(presetRole ?? 'tourist');
  const [form, setForm] = useState({ fullName: '', email: '', password: '', otp: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [accessError, setAccessError] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [otpLeft, restartOtp] = useCountdown(0);
  const [resendLeft, restartResend] = useCountdown(0);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const switchTab = (t) => {
    setTab(t);
    setPhase('role');
    setErrors({});
    setServerError('');
    setNotice('');
    setAccessError(null);
    navigate(`/${t}${location.search}`, { replace: true });
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
    setAccessError(null);
    try {
      await fn();
    } catch (err) {
      // Lỗi xác thực theo trường (nếu server trả details) -> gắn vào field.
      if (err?.details && typeof err.details === 'object') setErrors((p) => ({ ...p, ...err.details }));
      const messages = {
        account_locked: 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Hãy thử lại sau hoặc đặt lại mật khẩu.',
        account_banned: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên của dự án để được hỗ trợ.',
        invalid_credentials: 'Email hoặc mật khẩu không đúng. Hãy kiểm tra và thử lại.',
      };
      if (tab === 'login' && (messages[err.code] || err.offline)) {
        setAccessError({ code: err.offline ? 'offline' : err.code, message: messages[err.code] || 'Chưa kết nối được máy chủ. Hãy kiểm tra mạng và thử đăng nhập lại.' });
      } else setServerError(err?.message || 'Có lỗi xảy ra, vui lòng thử lại');
    } finally {
      setBusy(false);
    }
  }

  const finish = (user) => navigate(destinationFor(user, next), { replace: true });

  const onLogin = (e) => {
    e.preventDefault();
    if (!validate()) return;
    go(async () => finish(await login({ email: form.email.trim(), password: form.password })));
  };

  const onRegister = (e) => {
    e.preventDefault();
    if (!validate()) return;
    go(async () => {
      const res = await register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        role,
      });
      setPhase('otp');
      restartOtp(res?.otpTtlSeconds || 120);
      restartResend(RESEND_LOCK_S);
      setNotice(`Đã gửi mã OTP tới ${form.email.trim()}.`);
    });
  };

  const onVerify = (e) => {
    e.preventDefault();
    if (!form.otp.trim()) {
      setErrors({ otp: 'Vui lòng nhập mã OTP' });
      return;
    }
    go(async () => {
      const user = await registerAndVerify({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        otp: form.otp.trim(),
      });
      finish(user);
    });
  };

  const onResend = () =>
    go(async () => {
      const res = await resendOtp({ email: form.email.trim(), purpose: 'register' });
      restartOtp(res?.otpTtlSeconds || 120);
      restartResend(RESEND_LOCK_S);
      setNotice('Đã gửi lại mã OTP.');
    });

  const roleMeta = ROLE_OPTIONS.find((o) => o.value === role);

  return (
    <div className={`screen auth ${tab === 'login' ? 'auth-login-a' : ''}`}>
      <header className="auth__top">
        <Link to="/" className="brand" aria-label="Về trang chủ GeoSound">
          <span className="brand__logo"><Icon name="headphones" size={20} /></span>
          <span className="brand__name">GeoSound</span>
        </Link>
      </header>

      <main className="auth__main">
        {tab === 'login' ? <section className="login-a-story" aria-label="GeoSound">
          <span className="chip"><Icon name="headphones" size={16} /> Khám phá bằng âm thanh</span>
          <h2>Mỗi bước chân,<br />một câu chuyện.</h2>
          <p>Lắng nghe những câu chuyện về văn hóa và con người tại nơi bạn đến.</p>
          <Link className="btn" to="/">Tiếp tục khám phá <Icon name="arrow-left" size={18} /></Link>
        </section> : null}
        <div className="auth__card">
          {tab === 'register' && phase === 'otp' ? (
            <>
              <button className="linkbtn auth__back" onClick={() => setPhase('form')}>
                <Icon name="arrow-left" size={16} /> Quay lại
              </button>
              <h1 className="auth__h1">Xác thực email</h1>
              <p className="muted small">Nhập mã OTP gồm 6 số đã gửi tới email của bạn.</p>

              {notice ? <p className="auth__notice" role="status">{notice}</p> : null}
              <ErrorAlert>{serverError}</ErrorAlert>

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
                  hint={otpLeft ? `Mã còn hiệu lực ${formatCountdown(otpLeft)}` : 'Mã đã hết hạn — hãy gửi lại mã mới.'}
                />
                <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
                  {busy ? <Icon name="loader" size={18} className="spin" /> : null}
                  Xác thực & đăng nhập
                </button>
              </form>
              <button className="linkbtn auth__resend" onClick={onResend} disabled={busy || resendLeft > 0}>
                {resendLeft > 0 ? `Gửi lại mã sau ${resendLeft} giây` : 'Gửi lại mã OTP'}
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

              {tab === 'register' && phase === 'role' ? (
                <>
                  <h1 className="auth__h1">Bạn dùng GeoSound để…</h1>
                  <p className="muted small">Chọn một — tác giả vẫn nghe được mọi tour như khách.</p>
                  <div className="rolepick" role="radiogroup" aria-label="Loại tài khoản">
                    {ROLE_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={role === o.value}
                        className={`rolecard ${role === o.value ? 'is-active' : ''}`}
                        onClick={() => {
                          setRole(o.value);
                          setPhase('form');
                        }}
                      >
                        <span className="rolecard__icon"><Icon name={o.icon} size={22} /></span>
                        <span className="rolecard__text">
                          <b>{o.title}</b>
                          <span className="muted small">{o.desc}</span>
                        </span>
                        <Icon name="chevron-left" size={18} className="rolecard__chev" />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {tab === 'register' ? (
                    <button className="linkbtn auth__back" onClick={() => setPhase('role')}>
                      <Icon name="arrow-left" size={16} /> {roleMeta.title}
                    </button>
                  ) : null}
                  <h1 className="auth__h1">
                    {tab === 'login' ? 'Chào mừng trở lại' : role === 'contributor' ? 'Tạo tài khoản tác giả' : 'Tạo tài khoản'}
                  </h1>
                  <p className="muted small">
                    {tab === 'login'
                      ? leadFor(next)
                      : role === 'contributor'
                        ? 'Sau khi xác thực email, bạn vào thẳng Studio để tạo tour đầu tiên.'
                        : 'Lưu lịch trình và tiến độ nghe trên mọi thiết bị.'}
                  </p>

                  <ErrorAlert>{serverError}</ErrorAlert>
                  {tab === 'login' && accessError ? <section className="alert alert--warn" role="alert">
                    <Icon name="alert-triangle" size={22} />
                    <div><b>{accessError.code === 'account_banned' ? 'Tài khoản đã bị khóa' : accessError.code === 'account_locked' ? 'Tài khoản tạm khóa' : 'Đăng nhập chưa thành công'}</b>
                      <p>{accessError.message}</p>
                      {accessError.code === 'account_locked' ? <Link to={'/forgot-password' + location.search} className="linkbtn">Đặt lại mật khẩu</Link> : null}
                      <Link to="/" className="linkbtn">Tiếp tục khám phá</Link>
                    </div>
                  </section> : null}

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
                    <PasswordField
                      id="password"
                      autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                      placeholder="••••••••"
                      value={form.password}
                      onChange={set('password')}
                      error={errors.password}
                      hint={tab === 'register' ? 'Tối thiểu 8 ký tự, có chữ và số.' : undefined}
                    />
                    {tab === 'login' ? (
                      <Link className="linkbtn auth__forgot" to={`/forgot-password${location.search}`}>
                        Quên mật khẩu?
                      </Link>
                    ) : null}
                    <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
                      {busy ? <Icon name="loader" size={18} className="spin" /> : null}
                      {tab === 'login' ? 'Đăng nhập' : 'Tiếp tục'}
                    </button>
                  </form>
                  {tab === 'login' ? <Link className="login-a-guest" to="/"><Icon name="headphones" size={24} /><span><b>Tiếp tục khám phá</b><span>Không cần tài khoản để tìm và nghe tour.</span></span><Icon name="chevron-down" size={18} /></Link> : null}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
