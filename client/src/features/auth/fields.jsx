// Trường nhập dùng chung cho các màn xác thực (UC01): nhãn + lỗi/gợi ý ngay dưới
// (a11y: aria-invalid + aria-describedby), ô mật khẩu có nút hiện/ẩn.
import { useState } from 'react';
import Icon from '../../components/Icon.jsx';

export function Field({ id, label, hint, error, children, ...props }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {children ?? (
        <input
          id={id}
          className="input"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          {...props}
        />
      )}
      {error ? (
        <p id={`${id}-err`} className="field__err" role="alert">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function PasswordField({ id, label = 'Mật khẩu', hint, error, ...props }) {
  const [shown, setShown] = useState(false);
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="pwfield">
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          {...props}
        />
        <button
          type="button"
          className="pwfield__toggle"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          aria-pressed={shown}
        >
          <Icon name={shown ? 'eye-off' : 'eye'} size={18} />
        </button>
      </div>
    </Field>
  );
}

export function ErrorAlert({ children }) {
  if (!children) return null;
  return (
    <div className="alert alert--warn" role="alert">
      <Icon name="alert-triangle" size={18} className="alert__icon" />
      <div>{children}</div>
    </div>
  );
}
