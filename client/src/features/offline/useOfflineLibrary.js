// UC03 — packages stored on this device, refreshed on every download change.
// `tourId` limits the list to one tour (tour detail). progress events only re-render (live bytes).
import { useCallback, useEffect, useRef, useState } from 'react';
import { readLibrary } from '../../lib/offline-store.js';
import { subscribeDownloads } from '../../lib/offline-download.js';

export function useOfflineLibrary(tourId) {
  const [state, setState] = useState({ loading: true, error: null, packages: [], usedBytes: 0, covers: {} });
  const [, setTick] = useState(0);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const lib = await readLibrary();
      if (!alive.current) return;
      const packages = tourId ? lib.packages.filter((p) => p.tourId === tourId) : lib.packages;
      setState({ loading: false, error: null, ...lib, packages });
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, loading: false, error: e }));
    }
  }, [tourId]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    load();
  }, [load]);

  useEffect(() => {
    alive.current = true;
    load();
    const off = subscribeDownloads((e) => (e.type === 'change' ? load() : setTick((t) => t + 1)));
    return () => {
      alive.current = false;
      off();
    };
  }, [load]);

  return { ...state, reload: load, retry };
}
