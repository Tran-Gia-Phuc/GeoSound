// UC01 registration uses the real challenge APIs. Verification never creates a session.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { Field, PasswordField, ErrorAlert } from './fields.jsx';
import { register, verifyOtp, resendOtp } from '../../lib/auth.js';
import { useCountdown, formatCountdown } from '../../hooks/useCountdown.js';
import './registration-a.css';

export default function RegisterPage() {
  const [params] = useSearchParams();
  const [step, setStep] = useState('role');
  const [role, setRole] = useState(params.get('role') === 'contributor' ? 'contributor' : 'tourist');
  const [form, setForm] = useState({ fullName:'', email:'', password:'', confirm:'', otp:'' });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [left, restart] = useCountdown(0);
  const set = (key) => (e) => { setForm((f) => ({ ...f, [key]:e.target.value })); setErrors((v) => ({ ...v,[key]:'' })); };
  const loginHref = '/login' + (params.get('next') ? '?next=' + encodeURIComponent(params.get('next')) : '');
  async function run(fn) {
    if (busy) return;
    setBusy(true); setError(''); setErrors({});
    try { await fn(); } catch (e) {
      setErrors(e.details || (['invalid_otp','challenge_expired'].includes(e.code) ? { otp:e.message } : {}));
      setError(e.message || 'Chưa kết nối được máy chủ. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }
  function submit(e) {
    e.preventDefault();
    const problems = {};
    if (step === 'form') {
      if (!form.fullName.trim()) problems.fullName = 'Vui lòng nhập họ tên';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) problems.email = 'Email không hợp lệ';
      if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) problems.password = 'Mật khẩu tối thiểu 8 ký tự, gồm chữ và số';
      if (form.confirm !== form.password) problems.confirm = 'Mật khẩu xác nhận không khớp';
    } else if (!form.otp.trim()) problems.otp = 'Vui lòng nhập mã OTP';
    setErrors(problems);
    if (Object.keys(problems).length) return;
    run(async () => {
      if (step === 'form') {
        const result = await register({ fullName:form.fullName.trim(), email:form.email.trim(), password:form.password, role });
        restart(result.otpTtlSeconds ?? 120); setNotice('Mã xác thực đã được gửi tới email của bạn.'); setStep('otp');
      } else {
        await verifyOtp({ email:form.email.trim(), otp:form.otp.trim() });
        setForm((f) => ({ ...f, password:'', confirm:'', otp:'' })); setStep('complete');
      }
    });
  }
  const changeEmail = () => { setStep('form');setForm((f)=>({...f,otp:''}));setError('');setErrors({});setNotice(''); };
  return <div className="screen auth registration-a">
    <header className="auth__top"><Link to="/" className="brand"><span className="brand__logo"><Icon name="headphones" size={20} /></span><span className="brand__name">GeoSound</span></Link></header>
    <main className="auth__main"><section className="auth__card">
      <ol className="registration-a__steps" aria-label="Các bước đăng ký">{['Vai trò','Thông tin','Xác thực'].map((label,i)=><li key={label} aria-current={['role','form','otp'][i] === step ? 'step' : undefined}><span>{i+1}</span>{label}</li>)}</ol>
      {step === 'complete' ? <div className="registration-a__success" role="status"><Icon name="check-circle" size={64} /><h1>Đăng ký thành công!</h1><p>Tài khoản {role === 'contributor' ? 'tác giả' : 'khách du lịch'} của bạn đã được tạo.</p><Link className="btn btn--primary btn--block" to={loginHref}>Đăng nhập</Link></div> : <>
        <h1 className="auth__h1">{step === 'role' ? 'Bạn muốn làm gì?' : step === 'form' ? 'Tạo tài khoản' : 'Xác thực email'}</h1>
        <p className="muted">{step === 'otp' ? 'Nhập mã gồm 6 số đã gửi tới ' + form.email.trim() : 'Khám phá và chia sẻ những câu chuyện trên GeoSound.'}</p>
        <ErrorAlert>{error}</ErrorAlert>
        {step === 'role' ? <><fieldset className="registration-a__roles"><legend className="sr-only">Loại tài khoản</legend>{[
          { value:'tourist', icon:'headphones', label:'Khám phá & nghe tour', text:'Tìm điểm đến, nghe câu chuyện và lưu lịch trình.' },
          { value:'contributor', icon:'mic', label:'Tạo tour audio', text:'Tạo điểm dừng và kể câu chuyện theo cách của bạn.' },
        ].map((item)=><label key={item.value} className={'registration-a__role ' + (role === item.value ? 'is-active' : '')}><input type="radio" name="role" value={item.value} checked={role === item.value} onChange={()=>setRole(item.value)} /><Icon name={item.icon} size={32} /><b>{item.label}</b><span>{item.text}</span></label>)}</fieldset><button className="btn btn--primary btn--block" onClick={()=>setStep('form')}>Tiếp tục</button></> : <form className="auth__form" onSubmit={submit} noValidate aria-busy={busy}>
          {step === 'form' ? <><button type="button" className="linkbtn" onClick={()=>setStep('role')} disabled={busy}>Đổi vai trò</button>
            <Field id="fullName" label="Họ và tên" autoComplete="name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
            <Field id="email" label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
            <PasswordField id="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="Tối thiểu 8 ký tự, gồm chữ và số." />
            <PasswordField id="confirmPassword" label="Xác nhận mật khẩu" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
          </> : <>{notice ? <p className="auth__notice" role="status">{notice}</p> : null}<Field id="otp" label="Mã OTP" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={form.otp} onChange={set('otp')} error={errors.otp} hint={left ? 'Mã còn hiệu lực ' + formatCountdown(left) : 'Mã đã hết hạn. Hãy gửi lại mã.'} />
            <button type="button" className="linkbtn" disabled={busy} onClick={()=>run(async()=>{ const r = await resendOtp({ email:form.email.trim(), purpose:'register' }); restart(r.otpTtlSeconds ?? 120);setForm((f)=>({...f,otp:''}));setNotice('Đã gửi lại mã OTP.'); })}>Gửi lại mã OTP</button>
            <button type="button" className="linkbtn" disabled={busy} onClick={changeEmail}>Đổi email</button>
          </>}
          <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>{busy ? 'Đang xử lý…' : step === 'form' ? 'Tiếp tục' : 'Xác thực'}</button>
        </form>}
        <p className="registration-a__login">Đã có tài khoản? <Link to={loginHref}>Đăng nhập</Link></p>
      </>}
    </section></main>
  </div>;
}
