// =========================================================
// ImageListField — nhiều ảnh cho một điểm dừng (UC10): tải lên (chọn nhiều file
// một lần), xem lưới ảnh, chú thích từng ảnh, xoá. Giá trị: [{ url, caption }].
// =========================================================
import { useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { MEDIA_RULES, checkFile, uploadMedia } from '../../lib/media.js';

const MAX = 20;

/** @param {{ value: Array<{url:string, caption:string}>, onChange: (v) => void }} props */
export default function ImageListField({ value, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(0); // số ảnh đang tải
  const [err, setErr] = useState('');

  async function handle(files) {
    const list = [...(files || [])].slice(0, MAX - value.length);
    if (!list.length) return;
    setErr('');
    const problems = [];
    let current = value;
    setBusy(list.length);
    for (const file of list) {
      const bad = checkFile(file, 'image');
      if (bad) {
        problems.push(`${file.name}: ${bad}`);
      } else {
        try {
          const r = await uploadMedia(file, 'image');
          current = [...current, { url: r.url, caption: '' }];
          onChange(current);
        } catch (e) {
          problems.push(`${file.name}: ${e.message || 'tải lên thất bại'}`);
        }
      }
      setBusy((n) => n - 1);
    }
    if (problems.length) setErr(problems.join(' · '));
    if (input.current) input.current.value = '';
  }

  const setCaption = (i, caption) => onChange(value.map((im, j) => (j === i ? { ...im, caption } : im)));
  const remove = (i) => onChange(value.filter((_, j) => j !== i));

  return (
    <div className="field imagelist">
      <span className="field__label">Hình ảnh</span>
      <input
        ref={input}
        type="file"
        accept={MEDIA_RULES.image.accept}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Chọn ảnh"
        onChange={(e) => handle(e.target.files)}
      />
      {value.length ? (
        <ul className="imagelist__grid">
          {value.map((im, i) => (
            <li key={`${im.url}-${i}`} className="imagelist__item">
              <img src={im.url} alt={im.caption || `Ảnh ${i + 1}`} />
              <input
                className="input imagelist__caption"
                value={im.caption}
                onChange={(e) => setCaption(i, e.target.value)}
                placeholder="Chú thích (tuỳ chọn)"
                maxLength={300}
                aria-label={`Chú thích ảnh ${i + 1}`}
              />
              <button type="button" className="iconbtn iconbtn--sm imagelist__remove" onClick={() => remove(i)} aria-label={`Xoá ảnh ${i + 1}`}>
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {value.length < MAX ? (
        <button
          type="button"
          className="filedrop__zone imagelist__add"
          onClick={() => input.current?.click()}
          disabled={busy > 0}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handle(e.dataTransfer.files);
          }}
        >
          {busy ? <Icon name="loader" size={22} className="spin" /> : <Icon name="image" size={22} />}
          <span>
            <b>{busy ? `Đang tải ${busy} ảnh…` : value.length ? 'Thêm ảnh' : 'Chọn ảnh'}</b>
            <span className="muted small"> — chọn được nhiều ảnh một lúc</span>
          </span>
        </button>
      ) : null}
      {err ? <span className="field__err" role="alert">{err}</span> : <span className="field__hint">{MEDIA_RULES.image.label} mỗi ảnh, tối đa {MAX} ảnh.</span>}
    </div>
  );
}
