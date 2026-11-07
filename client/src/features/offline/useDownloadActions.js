// UC03 — download actions shared by the tour detail and the library, with toasts.
import { useCallback, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { langLabel } from '../../lib/format.js';
import { getPackage, packageKey } from '../../lib/offline-store.js';
import {
  cancelDownload,
  pauseDownload,
  resumeDownload,
  startDownload,
  StorageFullError,
} from '../../lib/offline-download.js';

function messageOf(e) {
  if (e?.offline) return 'Cần kết nối mạng (Wi-Fi hoặc dữ liệu di động) để tải tour';
  return e?.message || 'Chưa tải được tour';
}

export function useDownloadActions() {
  const { authenticated } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState(null); // error with no package record (manifest, no network)

  const afterRun = useCallback(
    async (key, language) => {
      const pkg = await getPackage(key).catch(() => null);
      if (pkg?.status === 'ready') toast.show(`Tải tour thành công (${langLabel(language)})`);
    },
    [toast],
  );

  const handle = useCallback(
    async (key, language, run) => {
      try {
        await run();
        await afterRun(key, language);
        return true;
      } catch (e) {
        const pkg = await getPackage(key).catch(() => null);
        // With a package record the row shows the reason (no space, offline, failed files).
        if (!pkg) setStartError({ language, message: messageOf(e) });
        if (e instanceof StorageFullError) return false;
        return !e?.offline;
      }
    },
    [afterRun],
  );

  const start = useCallback(
    async (tourId, languages) => {
      setStartError(null);
      setBusy(true);
      try {
        for (const language of languages) {
          const ok = await handle(packageKey(tourId, language), language, () => startDownload(tourId, language, { authenticated }));
          if (!ok) break; // no space / no network: do not start the next language
        }
      } finally {
        setBusy(false);
      }
    },
    [authenticated, handle],
  );

  const resume = useCallback(
    (pkg) => {
      setStartError(null);
      return handle(pkg.key, pkg.language, () => resumeDownload(pkg.key, { authenticated }));
    },
    [authenticated, handle],
  );

  const pause = useCallback((pkg) => pauseDownload(pkg.key), []);

  const cancel = useCallback(
    async (pkg) => {
      try {
        await cancelDownload(pkg.key);
        toast.show(`Đã huỷ tải bản ${langLabel(pkg.language)}`);
      } catch {
        toast.show('Chưa huỷ được, vui lòng thử lại', { tone: 'danger' });
      }
    },
    [toast],
  );

  return { start, resume, pause, cancel, busy, startError, clearStartError: () => setStartError(null) };
}
