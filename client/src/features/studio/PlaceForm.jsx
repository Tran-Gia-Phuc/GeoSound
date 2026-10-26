// =========================================================
// PlaceForm (UC10) — biểu mẫu thêm/sửa điểm dừng. Mô tả BẮT BUỘC (E3).
// Toạ độ nhập tay hoặc chọn trên bản đồ (nút "Chọn trên bản đồ" bật chế độ
// chạm bản đồ ở trang cha; toạ độ chạm được bơm vào qua prop `pick`).
// Ảnh (nhiều) + audio người thật tuỳ chọn — TẢI FILE LÊN (không phải dán URL);
// không có audio thì hệ thống đọc mô tả bằng giọng máy (UC12).
// =========================================================
import { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import FileDrop from '../../components/media/FileDrop.jsx';
import ImageListField from '../../components/media/ImageListField.jsx';
import { PLACE_TYPE_OPTIONS } from '../../lib/studio.js';

const isHttpUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

export default function PlaceForm({
  initial, pick, picking, onRequestPick, serverError, busy, onSubmit, onCancel,
}) {
  const [f, setF] = useState(() => ({
    name: initial?.name ?? '',
    type: initial?.type ?? 'landmark',
    description: initial?.description ?? '',
    lat: initial?.lat != null ? String(initial.lat) : '',
    lng: initial?.lng != null ? String(initial.lng) : '',
    images: initial?.images?.length ? initial.images.map((i) => ({ url: i.url, caption: i.caption ?? '' })) : [],
    audioUrl: initial?.audioUrl ?? '',
  }));
  const [errs, setErrs] = useState({});
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  // Bơm toạ độ chạm từ bản đồ (parent tăng pick.nonce mỗi lần chạm).
  useEffect(() => {
    if (pick && Number.isFinite(pick.lat) && Number.isFinite(pick.lng)) {
      setF((s) => ({ ...s, lat: pick.lat.toFixed(6), lng: pick.lng.toFixed(6) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick?.nonce]);


  function validate() {
    const next = {};
    if (!f.name.trim()) next.name = 'Vui lòng nhập tên địa điểm';
    if (!f.description.trim()) next.description = 'Mô tả là bắt buộc';
    const lat = Number(f.lat);
    const lng = Number(f.lng);
    if (f.lat === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) next.lat = 'Vĩ độ từ -90 đến 90';
    if (f.lng === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) next.lng = 'Kinh độ từ -180 đến 180';
    f.images.forEach((im, i) => {
      if (im.url.trim() && !isHttpUrl(im.url.trim())) next[`img${i}`] = 'URL ảnh không hợp lệ';
    });
    if (f.audioUrl.trim() && !isHttpUrl(f.audioUrl.trim())) next.audioUrl = 'URL audio không hợp lệ';
    setErrs(next);
    return Object.keys(next).length === 0;
  }

  function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!validate()) return;
    const images = f.images
      .filter((im) => im.url.trim())
      .map((im) => (im.caption.trim() ? { url: im.url.trim(), caption: im.caption.trim() } : { url: im.url.trim() }));
    onSubmit({
      name: f.name.trim(),
      type: f.type,
      description: f.description.trim(),
      lat: Number(f.lat),
      lng: Number(f.lng),
      images,
      audioUrl: f.audioUrl.trim(),
    });
  }

  return (
    <form className="studio-form place-form" onSubmit={submit} noValidate>
      {serverError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{serverError}</div>
        </div>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor="pf-name">Tên địa điểm *</label>
        <input id="pf-name" className="input" value={f.name} onChange={set('name')} maxLength={200}
          aria-invalid={!!errs.name} placeholder="Ví dụ: Chùa Cầu" />
        {errs.name ? <span className="field__err">{errs.name}</span> : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="pf-type">Loại địa điểm</label>
        <select id="pf-type" className="input" value={f.type} onChange={set('type')}>
          {PLACE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="pf-desc">Mô tả * <span className="field__hint">(nội dung thuyết minh)</span></label>
        <textarea id="pf-desc" className="input studio-form__textarea" value={f.description} onChange={set('description')}
          maxLength={5000} rows={4} aria-invalid={!!errs.description} placeholder="Nội dung giới thiệu về địa điểm này…" />
        {errs.description ? <span className="field__err">{errs.description}</span> : (
          <span className="field__hint">{f.description.length}/5000 ký tự</span>
        )}
      </div>

      <div className="field">
        <div className="place-form__coordhead">
          <span className="field__label">Toạ độ *</span>
          <button type="button" className={`btn btn--ghost btn--sm ${picking ? 'is-active' : ''}`} onClick={onRequestPick}>
            <Icon name="crosshair" size={16} /> {picking ? 'Chạm bản đồ để chọn…' : 'Chọn trên bản đồ'}
          </button>
        </div>
        <div className="studio-form__row">
          <div className="field">
            <label className="field__label small" htmlFor="pf-lat">Vĩ độ (lat)</label>
            <input id="pf-lat" className="input" value={f.lat} onChange={set('lat')} inputMode="decimal"
              aria-invalid={!!errs.lat} placeholder="15.8801" />
            {errs.lat ? <span className="field__err">{errs.lat}</span> : null}
          </div>
          <div className="field">
            <label className="field__label small" htmlFor="pf-lng">Kinh độ (lng)</label>
            <input id="pf-lng" className="input" value={f.lng} onChange={set('lng')} inputMode="decimal"
              aria-invalid={!!errs.lng} placeholder="108.3380" />
            {errs.lng ? <span className="field__err">{errs.lng}</span> : null}
          </div>
        </div>
      </div>

      <ImageListField value={f.images} onChange={(images) => setF((st) => ({ ...st, images }))} />

      <FileDrop
        kind="audio"
        label="Audio thuyết minh (giọng người thật)"
        hint="Không bắt buộc — để trống thì hệ thống đọc mô tả bằng giọng máy."
        value={f.audioUrl}
        onChange={(url) => setF((st) => ({ ...st, audioUrl: url }))}
        error={errs.audioUrl}
      />

      <div className="studio-form__actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Huỷ</button>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? <Icon name="loader" size={18} className="spin" /> : <Icon name="check-circle" size={18} />}
          {initial ? 'Lưu điểm' : 'Thêm điểm'}
        </button>
      </div>
    </form>
  );
}
