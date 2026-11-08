// =========================================================
// OfflineDownload — "Tải về để nghe offline" section of the public tour detail (UC03 #103).
//   - One row per language of the tour: not downloaded -> checkbox; downloading / paused ->
//     PackageProgress; ready -> "Đã tải" with the real size and a link to the offline player.
//   - "Tải xuống" downloads the checked languages one after the other.
//   - Storage unavailable (private mode, blocked) -> notice, no download button.
// =========================================================
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { formatBytes, langLabel } from '../../lib/format.js';
import { packageBytes } from '../../lib/offline-store.js';
import { useOfflineLibrary } from './useOfflineLibrary.js';
import { useDownloadActions } from './useDownloadActions.js';
import PackageProgress from './PackageProgress.jsx';
import './offline.css';

export const offlinePlayUrl = (tourId, language, mode = 'remote') =>
  `/offline/${encodeURIComponent(tourId)}/play?${new URLSearchParams({ lang: language, mode }).toString()}`;

export default function OfflineDownload({ tour, restricted = false }) {
  const lib = useOfflineLibrary(tour.id);
  const actions = useDownloadActions();
  const [checked, setChecked] = useState(() => new Set([tour.selectedLanguage]));

  const byLang = useMemo(() => new Map(lib.packages.map((p) => [p.language, p])), [lib.packages]);
  const languages = useMemo(() => {
    const list = [...(tour.availableLanguages?.length ? tour.availableLanguages : [tour.selectedLanguage])];
    for (const p of lib.packages) if (!list.includes(p.language)) list.push(p.language);
    return list;
  }, [tour.availableLanguages, tour.selectedLanguage, lib.packages]);
  const selectable = languages.filter((code) => !byLang.has(code));
  const toDownload = selectable.filter((code) => checked.has(code));

  const toggle = (code) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <section className="detail__section offline-dl" aria-labelledby="offline-h">
      <h2 className="detail__h2" id="offline-h">
        <Icon name="download" size={16} /> Tải về để nghe offline
      </h2>

      {lib.loading ? (
        <p className="muted small"><Icon name="loader" size={14} className="spin" /> Đang kiểm tra bộ nhớ…</p>
      ) : lib.error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>Thiết bị này không cho phép lưu tour offline (bộ nhớ trình duyệt bị chặn hoặc ở chế độ riêng tư).</div>
          <button type="button" className="btn btn--sm" onClick={lib.retry}>Thử lại</button>
        </div>
      ) : (
        <>
          <p className="muted small">
            Gói tải gồm nội dung, ảnh và bản ghi âm của ngôn ngữ đã chọn. Điểm không có bản ghi âm sẽ được đọc bằng giọng của thiết bị.
          </p>
          {restricted ? (
            <p className="muted small">Bản thử nghiệm: chỉ lưu trên thiết bị này; kiểm tra bản mới cần đăng nhập và mã truy cập còn hiệu lực.</p>
          ) : null}
          <ul className="offline-dl__langs" aria-label="Ngôn ngữ tải về">
            {languages.map((code) => {
              const pkg = byLang.get(code);
              if (!pkg) {
                return (
                  <li key={code} className="offline-dl__lang">
                    <label className="offline-dl__check">
                      <input type="checkbox" checked={checked.has(code)} onChange={() => toggle(code)} disabled={actions.busy} />
                      {langLabel(code)}
                    </label>
                  </li>
                );
              }
              return (
                <li key={code} className="offline-dl__lang">
                  <div className="offline-dl__head">
                    <b>{langLabel(code)}</b>
                    {pkg.status === 'ready' ? (
                      <span className="chip chip--ok"><Icon name="check-circle" size={13} /> Đã tải · {formatBytes(packageBytes(pkg))}</span>
                    ) : null}
                  </div>
                  {pkg.status === 'ready' ? (
                    <Link className="linkbtn small" to={offlinePlayUrl(tour.id, code)}>
                      <Icon name="headphones" size={14} /> Mở bản offline
                    </Link>
                  ) : (
                    <PackageProgress
                      pkg={pkg}
                      onPause={() => actions.pause(pkg)}
                      onResume={() => actions.resume(pkg)}
                      onCancel={() => actions.cancel(pkg)}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {actions.startError ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="wifi-off" size={18} className="alert__icon" />
              <div>{actions.startError.message}</div>
            </div>
          ) : null}

          <div className="row offline-dl__actions">
            {selectable.length ? (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={!toDownload.length || actions.busy}
                onClick={() => actions.start(tour.id, toDownload, { restricted })}
              >
                {actions.busy ? <Icon name="loader" size={14} className="spin" /> : <Icon name="download" size={14} />}
                {' '}Tải xuống{toDownload.length > 1 ? ` (${toDownload.length} ngôn ngữ)` : ''}
              </button>
            ) : null}
            <Link className="btn btn--ghost btn--sm" to="/offline">Tour đã tải</Link>
          </div>
        </>
      )}
    </section>
  );
}
