// =========================================================
// FileDrop — ô tải MỘT ảnh hoặc audio (thay cho ô dán URL ở Studio).
//   - chạm để chọn file (điện thoại mở thư viện ảnh / file) hoặc kéo thả
//   - đang tải: vòng quay; xong: xem trước (ảnh / trình nghe) + Thay · Gỡ
//   - vẫn cho dán đường dẫn có sẵn (mục thu gọn "Dùng đường dẫn")
//   - audio: có thể GHI ÂM ngay trên trình duyệt (AudioRecorder) rồi tải lên
// Giá trị là URL công khai (string) hoặc '' khi trống.
// =========================================================
import { useId, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { MEDIA_RULES, checkFile, uploadMedia } from '../../lib/media.js';
import AudioRecorder from './AudioRecorder.jsx';

const isHttpUrl = (s) => /^https?:\/\/\S+$/i.test(s || '');

/**
 * @param {{ kind: 'image'|'audio', value: string, onChange: (url: string) => void,
 *           label: string, hint?: string, error?: string }} props
 */
export default function FileDrop({ kind, value, onChange, label, hint, error }) {
  const id = useId();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const rule = MEDIA_RULES[kind];

  async function handle(file) {
    if (!file) return;
    const bad = checkFile(file, kind);
    if (bad) {
      setErr(bad);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await uploadMedia(file, kind);
      onChange(r.url);
      setRecording(false);
    } catch (e) {
      setErr(e.message || 'Tải lên thất bại, vui lòng thử lại');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const pick = () => input.current?.click();
  const shownError = err || error;

  return (
    <div className="field filedrop">
      <span className="field__label" id={`${id}-label`}>{label}</span>
      <input
        ref={input}
        type="file"
        accept={rule.accept}
        className="sr-only"
        aria-labelledby={`${id}-label`}
        onChange={(e) => handle(e.target.files?.[0])}
        tabIndex={-1}
      />

      {recording ? (
        <AudioRecorder busy={busy} onUse={(file) => handle(file)} onCancel={() => setRecording(false)} />
      ) : value ? (
        <div className={`filedrop__preview filedrop__preview--${kind}`}>
          {kind === 'image' ? (
            <img src={value} alt="" className="filedrop__img" />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio src={value} controls preload="none" className="filedrop__audio" />
          )}
          <div className="filedrop__actions">
            <button type="button" className="btn btn--sm" onClick={pick} disabled={busy}>
              {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="download" size={16} />} Thay
            </button>
            {kind === 'audio' ? (
              <button type="button" className="btn btn--sm" onClick={() => setRecording(true)} disabled={busy}>
                <Icon name="mic" size={16} /> Ghi lại
              </button>
            ) : null}
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange('')} disabled={busy}>
              <Icon name="trash" size={16} /> Gỡ
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`filedrop__zone ${over ? 'is-over' : ''}`}
          onClick={pick}
          disabled={busy}
          aria-describedby={`${id}-hint`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            handle(e.dataTransfer.files?.[0]);
          }}
        >
          {busy ? (
            <Icon name="loader" size={24} className="spin" />
          ) : (
            <Icon name={kind === 'image' ? 'image' : 'volume'} size={24} />
          )}
          <span>
            <b>{busy ? 'Đang tải lên…' : kind === 'image' ? 'Chọn ảnh' : 'Chọn file audio'}</b>
            <span className="muted small"> hoặc kéo thả vào đây</span>
          </span>
        </button>
      )}
      {kind === 'audio' && !value && !recording ? (
        <button type="button" className="btn btn--ghost btn--sm filedrop__rec" onClick={() => setRecording(true)} disabled={busy}>
          <Icon name="mic" size={16} /> Ghi âm ngay trên máy
        </button>
      ) : null}

      {shownError ? (
        <span className="field__err" role="alert">{shownError}</span>
      ) : (
        <span className="field__hint" id={`${id}-hint`}>{hint ? `${hint} ` : ''}{rule.label}.</span>
      )}

      {!value && !recording ? (
        <details className="filedrop__url">
          <summary>Dùng đường dẫn có sẵn</summary>
          <div className="filedrop__urlrow">
            <input
              className="input"
              placeholder="https://…"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              aria-label={`Đường dẫn ${label.toLowerCase()}`}
            />
            <button
              type="button"
              className="btn btn--sm"
              disabled={!isHttpUrl(urlDraft.trim())}
              onClick={() => {
                onChange(urlDraft.trim());
                setUrlDraft('');
              }}
            >
              Dùng
            </button>
          </div>
        </details>
      ) : null}
    </div>
  );
}
