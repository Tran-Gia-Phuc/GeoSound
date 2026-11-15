// =========================================================
// RequestChangesDialog — UC19 A3 (Frontend #126): ask the author to fix a tour.
//   The API takes one reason string (1..1000). The admin writes a general note and/or a note per
//   stop; the notes are joined (joinChangeRequest) into "…\nĐiểm 2 – <name>: <note>".
//   At least one note is required; the joined text must fit REASON_MAX. A server error (422)
//   is shown inside the dialog via `error`.
// =========================================================
import { useEffect, useId, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import { joinChangeRequest, REASON_MAX } from '../../lib/admin-reviews.js';

export default function RequestChangesDialog({ open, places = [], busy = false, error = null, onConfirm, onCancel }) {
  const id = useId();
  const [general, setGeneral] = useState('');
  const [notes, setNotes] = useState({}); // placeId -> note
  const [invalid, setInvalid] = useState(null);

  useEffect(() => {
    if (open) {
      setGeneral('');
      setNotes({});
      setInvalid(null);
    }
  }, [open]);

  const reason = joinChangeRequest(
    general,
    places.map((p, index) => ({ index, name: p.name, note: notes[p.id] })),
  );

  function submit(e) {
    e.preventDefault();
    if (!reason) return setInvalid('Vui lòng nhập lý do hoặc ghi chú cho ít nhất một điểm');
    if (reason.length > REASON_MAX) return setInvalid(`Lý do tối đa ${REASON_MAX} ký tự (tính cả ghi chú từng điểm)`);
    setInvalid(null);
    onConfirm(reason);
  }

  const shown = invalid || error;
  return (
    <Modal open={open} onClose={busy ? undefined : onCancel} title="Yêu cầu tác giả chỉnh sửa?" labelledBy={`${id}-title`}>
      <form className="confirm" onSubmit={submit} noValidate>
        <p className="confirm__msg">
          Tour chuyển sang "Cần chỉnh sửa", không công khai. Tác giả nhận email kèm nội dung bên dưới và gửi duyệt lại sau khi sửa.
        </p>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-general`}>Lý do chung</label>
          <textarea
            id={`${id}-general`}
            className="input studio-form__textarea"
            value={general}
            maxLength={REASON_MAX}
            onChange={(e) => {
              setGeneral(e.target.value);
              setInvalid(null);
            }}
          />
        </div>
        {places.length ? (
          <fieldset className="field review-notes">
            <legend className="field__label">Ghi chú theo điểm (không bắt buộc)</legend>
            {places.map((p, i) => (
              <div className="field" key={p.id}>
                <label className="field__label small" htmlFor={`${id}-stop-${i}`}>
                  Điểm {i + 1} – {p.name || 'Không tên'}
                </label>
                <input
                  id={`${id}-stop-${i}`}
                  className="input"
                  value={notes[p.id] || ''}
                  maxLength={REASON_MAX}
                  onChange={(e) => {
                    setNotes((n) => ({ ...n, [p.id]: e.target.value }));
                    setInvalid(null);
                  }}
                />
              </div>
            ))}
          </fieldset>
        ) : null}
        {shown ? (
          <span className="field__err" role="alert">{shown}</span>
        ) : (
          <span className="field__hint" data-testid="changes-length">
            {reason.length}/{REASON_MAX} ký tự
          </span>
        )}
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>Huỷ</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Đang xử lý…' : 'Gửi yêu cầu chỉnh sửa'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
