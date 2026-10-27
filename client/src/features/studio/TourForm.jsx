// =========================================================
// TourForm — biểu mẫu nội dung tour dùng chung cho tạo (UC09 bước 4–7) và
// sửa (A1). Kiểm tra tại chỗ theo từng trường (tên + ngôn ngữ gốc bắt buộc — E2;
// ảnh bìa tải lên hoặc URL hợp lệ — E3). Lỗi hiển thị ngay dưới ô nhập.
// Trả về `onSubmit(values)` đã chuẩn hoá (bỏ ô rỗng, duration là số).
// `compact` (tạo tour): chỉ hỏi tên + ngôn ngữ gốc + thành phố — phần còn lại bổ
// sung sau ở bước Thông tin. Có thay đổi chưa lưu → chặn rời màn (useDirtyGuard).
// =========================================================
import { useMemo, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import FileDrop from '../../components/media/FileDrop.jsx';
import { useDirtyGuard } from '../../hooks/useDirtyGuard.jsx';
import { TOUR_TYPE_OPTIONS, LANGUAGE_OPTIONS } from '../../lib/tours.js';

const isHttpUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const emptyForm = {
  title: '',
  originalLanguage: 'vi',
  type: 'walking',
  city: '',
  duration: '',
  description: '',
  coverImageUrl: '',
};

/**
 * @param {{
 *   initial?: object, submitLabel: string, busy?: boolean, serverError?: string,
 *   onSubmit: (values: object) => void, onCancel?: () => void, compact?: boolean,
 * }} props
 */
export default function TourForm({ initial, submitLabel, busy, serverError, onSubmit, onCancel, compact = false, renderPreview, secondarySubmit }) {
  const start = useMemo(() => ({
    ...emptyForm,
    ...(initial
      ? {
          title: initial.title ?? '',
          originalLanguage: initial.originalLanguage ?? 'vi',
          type: initial.type ?? 'walking',
          city: initial.city ?? '',
          duration: initial.duration != null ? String(initial.duration) : '',
          description: initial.description ?? '',
          coverImageUrl: initial.coverImageUrl ?? '',
        }
      : {}),
  }), [initial]);
  const [f, setF] = useState(start);
  const [errs, setErrs] = useState({});
  const dirty = Object.keys(start).some((k) => f[k] !== start[k]);
  const guard = useDirtyGuard(dirty && !busy);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  function validate() {
    const next = {};
    if (!f.title.trim()) next.title = 'Vui lòng nhập tên tour';
    else if (f.title.trim().length > 200) next.title = 'Tên tour tối đa 200 ký tự';
    if (!f.originalLanguage) next.originalLanguage = 'Vui lòng chọn ngôn ngữ gốc';
    if (f.description.length > 2000) next.description = 'Mô tả tối đa 2000 ký tự';
    if (f.coverImageUrl.trim() && !isHttpUrl(f.coverImageUrl.trim()))
      next.coverImageUrl = 'Ảnh bìa phải là đường dẫn http(s) hợp lệ';
    if (f.duration.trim()) {
      const n = Number(f.duration);
      if (!Number.isInteger(n) || n <= 0) next.duration = 'Thời lượng là số phút nguyên dương';
    }
    setErrs(next);
    return Object.keys(next).length === 0;
  }

  function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!validate()) return;
    const v = {
      title: f.title.trim(),
      originalLanguage: f.originalLanguage,
      type: f.type,
    };
    if (f.city.trim()) v.city = f.city.trim();
    if (f.duration.trim()) v.duration = Number(f.duration);
    // description cho phép rỗng (xoá mô tả); coverImageUrl rỗng thì bỏ qua (API cần URL).
    v.description = f.description.trim();
    if (f.coverImageUrl.trim()) v.coverImageUrl = f.coverImageUrl.trim();
    onSubmit(v, e.nativeEvent.submitter?.value === 'library' ? 'library' : 'places');
  }

  return (
    <form className="studio-form" onSubmit={submit} noValidate>
      {serverError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{serverError}</div>
        </div>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor="tf-title">Tên tour *</label>
        <input
          id="tf-title"
          className="input"
          value={f.title}
          onChange={set('title')}
          maxLength={200}
          aria-invalid={!!errs.title}
          aria-describedby={errs.title ? 'tf-title-err' : undefined}
          placeholder="Ví dụ: Dạo quanh phố cổ Hội An"
        />
        {errs.title ? <span id="tf-title-err" className="field__err">{errs.title}</span> : null}
      </div>

      <div className="studio-form__row">
        <div className="field">
          <label className="field__label" htmlFor="tf-lang">Ngôn ngữ gốc *</label>
          <select
            id="tf-lang"
            className="input"
            value={f.originalLanguage}
            onChange={set('originalLanguage')}
            aria-invalid={!!errs.originalLanguage}
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {errs.originalLanguage ? <span className="field__err">{errs.originalLanguage}</span> : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="tf-type">Loại tour</label>
          <select id="tf-type" className="input" value={f.type} onChange={set('type')}>
            {TOUR_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {compact ? (
        <div className="field">
          <label className="field__label" htmlFor="tf-city">Thành phố</label>
          <input
            id="tf-city"
            className="input"
            value={f.city}
            onChange={set('city')}
            maxLength={120}
            placeholder="Ví dụ: Hội An"
          />
          <span className="field__hint">Giúp khách tìm thấy tour theo thành phố. Ảnh bìa, mô tả… bổ sung sau.</span>
        </div>
      ) : (
      <>
      <div className="studio-form__row">
        <div className="field">
          <label className="field__label" htmlFor="tf-city">Thành phố</label>
          <input
            id="tf-city"
            className="input"
            value={f.city}
            onChange={set('city')}
            maxLength={120}
            placeholder="Ví dụ: Hội An"
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="tf-duration">Thời lượng (phút)</label>
          <input
            id="tf-duration"
            className="input"
            value={f.duration}
            onChange={set('duration')}
            inputMode="numeric"
            placeholder="Ví dụ: 90"
            aria-invalid={!!errs.duration}
          />
          {errs.duration ? <span className="field__err">{errs.duration}</span> : null}
        </div>
      </div>

      <FileDrop
        kind="image"
        label="Ảnh bìa"
        hint="Ảnh ngang đẹp nhất. Có thể bổ sung sau."
        value={f.coverImageUrl}
        onChange={(url) => setF((s) => ({ ...s, coverImageUrl: url }))}
        error={errs.coverImageUrl}
      />

      <div className="field">
        <label className="field__label" htmlFor="tf-desc">Mô tả</label>
        <textarea
          id="tf-desc"
          className="input studio-form__textarea"
          value={f.description}
          onChange={set('description')}
          maxLength={2000}
          rows={4}
          placeholder="Giới thiệu ngắn về tour…"
          aria-invalid={!!errs.description}
        />
        {errs.description ? <span className="field__err">{errs.description}</span> : (
          <span className="field__hint">{f.description.length}/2000 ký tự</span>
        )}
      </div>
      </>
      )}

      {renderPreview?.(f)}
      <div className="studio-form__actions">
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Huỷ</button>
        ) : null}
        {secondarySubmit ? <button type="submit" className="btn btn--ghost" name="destination" value="library" disabled={busy}>{secondarySubmit}</button> : null}
        <button type="submit" className="btn btn--primary" name="destination" value="places" disabled={busy}>
          {busy ? <Icon name="loader" size={18} className="spin" /> : <Icon name="check-circle" size={18} />}
          {submitLabel}
        </button>
      </div>
      {guard}
    </form>
  );
}
