// =========================================================
// AudioRecorder — ghi âm thuyết minh ngay trên trình duyệt (UC10: tác giả thu âm
// bằng điện thoại, không cần app khác). MediaRecorder → nghe lại → "Dùng bản
// ghi" thì trả về File (webm/opus trên Chrome, mp4/aac trên Safari) để tải lên.
// Giới hạn 10 phút; lỗi micro (chưa cấp quyền / không có micro) báo rõ.
// =========================================================
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';

const MAX_SECONDS = 600;
// Ưu tiên định dạng máy chủ nhận được, theo thứ tự trình duyệt hỗ trợ.
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

const supported = () =>
  typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined';

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** @param {{ onUse: (file: File) => void, onCancel: () => void, busy?: boolean }} props */
export default function AudioRecorder({ onUse, onCancel, busy }) {
  const [state, setState] = useState('idle'); // idle | recording | recorded
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [blobUrl, setBlobUrl] = useState('');
  const rec = useRef(null);
  const chunks = useRef([]);
  const stream = useRef(null);
  const timer = useRef(null);
  const blob = useRef(null);

  const cleanup = () => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => () => {
    cleanup();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setError('');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Chưa có quyền dùng micro — hãy cho phép trong cài đặt trình duyệt.'
          : 'Không tìm thấy micro trên thiết bị này.',
      );
      return;
    }
    const mimeType = TYPES.find((t) => window.MediaRecorder.isTypeSupported?.(t)) || '';
    const r = new window.MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      cleanup();
      blob.current = new Blob(chunks.current, { type: r.mimeType || mimeType || 'audio/webm' });
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl(URL.createObjectURL(blob.current));
      setState('recorded');
    };
    rec.current = r;
    r.start();
    setSeconds(0);
    setState('recording');
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) r.state === 'recording' && r.stop();
        return s + 1;
      });
    }, 1000);
  }

  const stop = () => rec.current?.state === 'recording' && rec.current.stop();

  function use() {
    const type = blob.current.type || 'audio/webm';
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    onUse(new File([blob.current], `ghi-am.${ext}`, { type }));
  }

  if (!supported()) {
    return <p className="field__err">Trình duyệt này không hỗ trợ ghi âm — hãy chọn file audio có sẵn.</p>;
  }

  return (
    <div className="recorder" role="group" aria-label="Ghi âm thuyết minh">
      {state === 'recording' ? (
        <div className="recorder__row">
          <span className="recorder__dot" aria-hidden="true" />
          <span className="recorder__time" aria-live="polite">Đang ghi {fmt(seconds)}</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={stop}>
            <Icon name="pause" size={14} /> Dừng
          </button>
        </div>
      ) : state === 'recorded' ? (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio src={blobUrl} controls className="filedrop__audio" />
          <div className="recorder__row">
            <span className="muted small">Bản ghi {fmt(seconds)}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={start} disabled={busy}>Ghi lại</button>
            <button type="button" className="btn btn--primary btn--sm" onClick={use} disabled={busy}>
              {busy ? <Icon name="loader" size={14} className="spin" /> : <Icon name="check-circle" size={14} />} Dùng bản ghi
            </button>
          </div>
        </>
      ) : (
        <div className="recorder__row">
          <button type="button" className="btn btn--primary btn--sm" onClick={start}>
            <Icon name="mic" size={14} /> Bắt đầu ghi
          </button>
          <span className="muted small">Tối đa 10 phút. Nói gần micro, nơi yên tĩnh.</span>
        </div>
      )}
      {error ? <p className="field__err" role="alert">{error}</p> : null}
      <button type="button" className="linkbtn recorder__cancel" onClick={() => { stop(); cleanup(); onCancel(); }}>
        Huỷ ghi âm
      </button>
    </div>
  );
}
