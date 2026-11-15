// =========================================================
// PackageProgress — state of one unfinished language package (UC03 #103, #104, #161).
//   Live: files done / total, bytes really stored (+ bytes being received), the estimate from
//   Content-Length; Tạm dừng / Huỷ. Paused, interrupted (reload), offline, failed files, no
//   space: the reason, Tiếp tục / Thử lại / Huỷ. Never shows a finished state before "ready".
// =========================================================
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { formatBytes, langLabel } from '../../lib/format.js';
import { packageBytes } from '../../lib/offline-store.js';
import {
  downloadError,
  effectiveStatus,
  inflightBytes,
  isDownloading,
  StorageFullError,
} from '../../lib/offline-download.js';

const REASONS = {
  user: 'Đã tạm dừng. Phần đã tải được giữ lại.',
  interrupted: 'Bị gián đoạn. Phần đã tải được giữ lại.',
  offline: 'Mất kết nối mạng. Phần đã tải được giữ lại.',
  error: 'Một số tệp chưa tải được.',
  quota: 'Không đủ dung lượng trên thiết bị.',
  starting: 'Chưa tải xong.',
};

const KIND = { image: 'Ảnh', audio: 'Âm thanh' };

export default function PackageProgress({ pkg, busy = false, onResume, onPause, onCancel }) {
  const live = isDownloading(pkg.key);
  const { pauseReason } = effectiveStatus(pkg);
  const err = downloadError(pkg.key);
  const total = pkg.assets.length;
  const done = pkg.assets.filter((a) => a.state === 'done').length;
  const failed = pkg.assets.filter((a) => a.state === 'error');
  const stored = packageBytes(pkg) + inflightBytes(pkg.key);
  const quota = err instanceof StorageFullError || (!live && pauseReason === 'quota');
  const lang = langLabel(pkg.language);

  return (
    <div className="offline-progress" data-testid={`progress-${pkg.language}`}>
      <progress
        className="offline-progress__bar"
        max={total || 1}
        value={total ? done : 0}
        aria-label={`Tiến trình tải ${lang}`}
      />
      <span className="small muted">
        {live ? 'Đang tải… ' : null}
        {done}/{total} tệp · đã lưu {formatBytes(stored)}
        {pkg.estimate?.bytes ? ` · cần khoảng ${formatBytes(pkg.estimate.bytes)}` : null}
        {pkg.estimate?.unknown ? ` (${pkg.estimate.unknown} tệp chưa rõ dung lượng)` : null}
      </span>

      {!live && !quota ? (
        <p className="small offline-progress__reason" role="status">
          {err?.offline ? REASONS.offline : REASONS[pauseReason] || REASONS.starting}
        </p>
      ) : null}

      {quota ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>
            <b>Không đủ dung lượng trên thiết bị</b>
            {err?.required ? <p className="small">Cần khoảng {formatBytes(err.required)} cho bản {lang}.</p> : null}
            {Number.isFinite(err?.available) && err.available !== null ? (
              <p className="small">Còn trống khoảng {formatBytes(err.available)}.</p>
            ) : null}
            <p className="small">Bản tải chưa hoàn tất. Hãy xoá bớt tour đã tải rồi thử lại.</p>
            <Link className="btn btn--sm" to="/offline">Quản lý tour đã tải</Link>
          </div>
        </div>
      ) : null}

      {failed.length && !live ? (
        <ul className="offline-progress__errors small" aria-label="Tệp lỗi">
          {failed.map((a) => (
            <li key={a.url}>
              <Icon name="alert-triangle" size={13} /> {KIND[a.kind] || 'Tệp'}: {a.error || 'Lỗi tải tệp'}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="row offline-progress__actions">
        {live ? (
          <button type="button" className="btn btn--sm" onClick={onPause} aria-label={`Tạm dừng tải ${lang}`}>
            <Icon name="pause" size={14} /> Tạm dừng
          </button>
        ) : (
          <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={onResume} aria-label={`${failed.length ? 'Thử lại' : 'Tiếp tục'} tải ${lang}`}>
            <Icon name="download" size={14} /> {failed.length ? 'Thử lại' : 'Tiếp tục'}
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={onCancel} aria-label={`Huỷ tải ${lang}`}>
          <Icon name="x" size={14} /> Huỷ
        </button>
      </div>
    </div>
  );
}
