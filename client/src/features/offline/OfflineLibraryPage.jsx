// =========================================================
// OfflineLibraryPage (/offline) — "Tour đã tải" (UC03 steps 6-7, A2, A3, E4; #158, #159, #160).
//   - Only packages really stored on this device (IndexedDB), grouped by tour, with each
//     language, its real size, the content date (revision) and the download date. No account.
//   - Ready language: Nghe / Đi tour from local data (works without network), Xoá with a
//     confirmation that shows the bytes really freed (files shared with another language stay).
//   - Unfinished language: PackageProgress (Tiếp tục / Huỷ). Ready but files missing: notice +
//     "Tải lại".
//   - Online only: "Có bản mới" when the server revision is newer; "Tour không còn công khai".
//   - Empty state only after a successful read; storage failure -> error with Thử lại.
// =========================================================
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatBytes, formatDateTime, langLabel } from '../../lib/format.js';
import { deletePackage, packageBytes, releasableBytes } from '../../lib/offline-store.js';
import { fetchTourPackage, isItineraryPackage, storageEstimate } from '../../lib/offline-download.js';
import { useOfflineLibrary } from './useOfflineLibrary.js';
import { useDownloadActions } from './useDownloadActions.js';
import PackageProgress from './PackageProgress.jsx';
import { offlinePlayUrl } from './OfflineDownload.jsx';
import './offline.css';

function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Server revision per ready package (online only): key -> { revision } | { gone: true }. */
function useServerRevisions(packages, online) {
  const [map, setMap] = useState({});
  const ready = packages.filter((p) => p.status === 'ready');
  const wanted = ready.map((p) => p.key).sort().join(',');
  const restrictedKeys = ready.filter((p) => p.restricted).map((p) => p.key).sort().join(',');
  useEffect(() => {
    if (!online || !wanted) return undefined;
    const abort = new AbortController();
    const restrictedSet = new Set(restrictedKeys.split(','));
    for (const key of wanted.split(',')) {
      const [tourId, language] = key.split('|');
      fetchTourPackage(tourId, language, { signal: abort.signal, restricted: restrictedSet.has(key) })
        .then((m) => setMap((cur) => ({ ...cur, [key]: { revision: m.revision } })))
        .catch((e) => {
          if (e?.name === 'AbortError') return;
          if (e?.status === 404) setMap((cur) => ({ ...cur, [key]: { gone: true } }));
        });
    }
    return () => abort.abort();
  }, [wanted, restrictedKeys, online]);
  return map;
}

const newer = (server, local) => !!server && !!local && new Date(server).getTime() > new Date(local).getTime();

export default function OfflineLibraryPage() {
  const toast = useToast();
  const lib = useOfflineLibrary();
  const actions = useDownloadActions();
  const online = useOnline();
  const server = useServerRevisions(lib.packages, online);
  const [space, setSpace] = useState(null);
  const [confirm, setConfirm] = useState(null); // { pkg, bytes }
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (lib.loading || lib.error) return;
    storageEstimate().then(setSpace);
  }, [lib.loading, lib.error, lib.usedBytes]);

  const tours = useMemo(() => {
    const groups = new Map();
    for (const p of lib.packages) {
      if (!groups.has(p.tourId)) groups.set(p.tourId, { tourId: p.tourId, title: p.title, packages: [] });
      groups.get(p.tourId).packages.push(p);
    }
    for (const g of groups.values()) g.packages.sort((a, b) => a.language.localeCompare(b.language));
    return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'vi'));
  }, [lib.packages]);

  async function askDelete(pkg) {
    try {
      setConfirm({ pkg, bytes: await releasableBytes(pkg.key) });
    } catch {
      toast.show('Không đọc được bộ nhớ trên thiết bị này', { tone: 'danger' });
    }
  }

  async function onDelete() {
    const { pkg } = confirm;
    setConfirm(null);
    setDeleting(true);
    try {
      const freed = await deletePackage(pkg.key);
      toast.show(`Đã xoá bản ${langLabel(pkg.language)} · giải phóng ${formatBytes(freed)}`);
    } catch {
      toast.show('Chưa xoá được, vui lòng thử lại', { tone: 'danger' });
    } finally {
      setDeleting(false);
      await lib.reload();
    }
  }

  return (
    <div className="page page--narrow offline-lib">
      <AppHeader title="Tour đã tải" backTo="/account" />

      {lib.error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>Không đọc được bộ nhớ trên thiết bị này. Tour đã tải chưa thể hiển thị.</div>
          <button type="button" className="btn btn--sm" onClick={lib.retry}>Thử lại</button>
        </div>
      ) : lib.loading ? (
        <p className="muted"><Icon name="loader" size={18} className="spin" /> Đang đọc dữ liệu trên máy…</p>
      ) : tours.length === 0 ? (
        <div className="emptybox offline-lib__empty">
          <Icon name="download" size={40} />
          <h2>Chưa có tour nào được tải</h2>
          <p className="muted">Tải tour về máy để nghe khi không có mạng. Mở một tour và chọn "Tải xuống".</p>
          <Link className="btn btn--primary" to="/">Tìm tour</Link>
        </div>
      ) : (
        <>
          <section className="card offline-lib__usage" aria-label="Dung lượng">
            <Icon name="download" size={18} />
            <div>
              <b>Đang dùng {formatBytes(lib.usedBytes)} trên thiết bị này</b>
              {space ? (
                <p className="muted small">Trình duyệt còn cho phép khoảng {formatBytes(space.available)}.</p>
              ) : null}
              {!online ? <p className="muted small"><Icon name="wifi-off" size={13} /> Đang offline — vẫn nghe được các tour đã tải.</p> : null}
            </div>
          </section>

          <ul className="offline-lib__tours" aria-label="Tour đã tải">
            {tours.map((g) => (
              <li key={g.tourId} className="card offline-tour">
                <div className="offline-tour__head">
                  {lib.covers[g.tourId] ? <img className="offline-tour__cover" src={lib.covers[g.tourId]} alt="" /> : null}
                  <h2 className="offline-tour__title">{g.title || 'Tour không tên'}</h2>
                  {isItineraryPackage(g.tourId) ? <span className="chip">Lịch trình</span> : null}
                </div>
                <ul className="offline-tour__langs" aria-label={`Ngôn ngữ đã tải của ${g.title}`}>
                  {g.packages.map((p) => {
                    const info = server[p.key];
                    return (
                      <li key={p.key} className="offline-lang" data-testid={`pkg-${p.language}`}>
                        <div className="offline-lang__head">
                          <b>{langLabel(p.language)}</b>
                          <span className="muted small">{formatBytes(packageBytes(p))}</span>
                          {p.status === 'ready' && !p.missing ? <span className="chip chip--ok">Sẵn sàng offline</span> : null}
                          {online && p.status === 'ready' && newer(info?.revision, p.revision) ? <span className="chip chip--warn">Có bản mới</span> : null}
                          {online && info?.gone ? <span className="chip">Tour không còn công khai</span> : null}
                        </div>
                        {p.revision ? (
                          <span className="muted small">Nội dung ngày {formatDateTime(p.revision)}{p.readyAt ? ` · tải lúc ${formatDateTime(p.readyAt)}` : ''}</span>
                        ) : null}

                        {p.status !== 'ready' ? (
                          <PackageProgress pkg={p} onPause={() => actions.pause(p)} onResume={() => actions.resume(p)} onCancel={() => actions.cancel(p)} />
                        ) : p.missing ? (
                          <div className="alert alert--warn" role="alert">
                            <Icon name="alert-triangle" size={18} className="alert__icon" />
                            <div>Dữ liệu trên máy bị thiếu {p.missing} tệp. Hãy tải lại hoặc xoá bản này.</div>
                          </div>
                        ) : null}

                        <div className="row offline-lang__actions">
                          {p.status === 'ready' && !p.missing ? (
                            <>
                              <Link className="btn btn--primary btn--sm" to={offlinePlayUrl(p.tourId, p.language, 'remote')}>
                                <Icon name="headphones" size={14} /> Nghe
                              </Link>
                              <Link className="btn btn--sm" to={offlinePlayUrl(p.tourId, p.language, 'gps')}>
                                <Icon name="navigation" size={14} /> Đi tour
                              </Link>
                            </>
                          ) : null}
                          {p.status === 'ready' && online && (p.missing || newer(info?.revision, p.revision)) && !info?.gone ? (
                            <button type="button" className="btn btn--sm" disabled={actions.busy} onClick={() => actions.start(p.tourId, [p.language], { restricted: !!p.restricted })}>
                              <Icon name="download" size={14} /> {p.missing ? 'Tải lại' : 'Cập nhật'}
                            </button>
                          ) : null}
                          {p.status === 'ready' ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={deleting}
                              onClick={() => askDelete(p)}
                              aria-label={`Xoá bản ${langLabel(p.language)} của ${g.title}`}
                            >
                              <Icon name="trash" size={14} /> Xoá
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {actions.startError ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="wifi-off" size={18} className="alert__icon" />
              <div>{actions.startError.message}</div>
            </div>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        danger
        title={confirm ? `Xoá bản ${langLabel(confirm.pkg.language)} của "${confirm.pkg.title}"?` : ''}
        message={
          confirm
            ? `Sẽ giải phóng ${formatBytes(confirm.bytes)} trên thiết bị. Các ngôn ngữ khác của tour vẫn được giữ nguyên.`
            : null
        }
        confirmLabel="Xoá"
        onConfirm={onDelete}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
