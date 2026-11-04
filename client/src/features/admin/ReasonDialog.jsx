// =========================================================
// ReasonDialog — confirm an admin decision with a reason box (UC20 hide / restore / dismiss,
// reused by UC21). `required` makes the reason mandatory; the length limit is REASON_MAX.
// The parent closes it; `error` shows a server error (e.g. 422) inside the dialog.
// `children` adds fields under the reason (UC21 suspension length); `validate()` checks them
// and returns an error text or null.
// =========================================================
import { useEffect, useId, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import { REASON_MAX } from '../../lib/admin-reports.js';

export default function ReasonDialog({
  open,
  title,
  message,
  confirmLabel,
  required = false,
  danger = false,
  busy = false,
  error = null,
  validate,
  children,
  onConfirm,
  onCancel,
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setInvalid(null);
    }
  }, [open]);

  function submit(e) {
    e.preventDefault();
    const text = reason.trim();
    if (required && !text) return setInvalid('Vui lòng nhập lý do');
    if (text.length > REASON_MAX) return setInvalid(`Lý do tối đa ${REASON_MAX} ký tự`);
    const extra = validate ? validate() : null;
    if (extra) return setInvalid(extra);
    setInvalid(null);
    onConfirm(text);
  }

  const shown = invalid || error;
  return (
    <Modal open={open} onClose={busy ? undefined : onCancel} title={title} labelledBy={`${id}-title`}>
      <form className="confirm" onSubmit={submit} noValidate>
        {message ? <p className="confirm__msg">{message}</p> : null}
        <div className="field">
          <label className="field__label" htmlFor={`${id}-reason`}>
            {required ? 'Lý do (bắt buộc)' : 'Lý do (không bắt buộc)'}
          </label>
          <textarea
            id={`${id}-reason`}
            className="input studio-form__textarea"
            value={reason}
            maxLength={REASON_MAX}
            aria-invalid={shown ? 'true' : undefined}
            aria-describedby={`${id}-hint`}
            onChange={(e) => setReason(e.target.value)}
          />
          {shown ? (
            <span className="field__err" role="alert">{shown}</span>
          ) : (
            <span className="field__hint" id={`${id}-hint`}>
              {reason.trim().length}/{REASON_MAX} ký tự
            </span>
          )}
        </div>
        {children}
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>Huỷ</button>
          <button type="submit" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} disabled={busy}>
            {busy ? 'Đang xử lý…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
