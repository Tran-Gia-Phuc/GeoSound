// =========================================================
// useTourProgress — lưu tiến độ nghe tour (UC04 A4: tạm rời & quay lại).
// Lưu localStorage theo tourId: các điểm đã nghe + điểm cuối + ngôn ngữ.
// Bọc try/catch: chế độ riêng tư / chặn storage vẫn chạy bình thường.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = (tourId) => `geosound:progress:${tourId}`;

function read(tourId) {
  try {
    const raw = localStorage.getItem(KEY(tourId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { visited: Array.isArray(p.visited) ? p.visited : [], lastPlaceId: p.lastPlaceId ?? null, lang: p.lang ?? null };
  } catch {
    return null;
  }
}

export function useTourProgress(tourId) {
  const [progress, setProgress] = useState(() => (tourId ? read(tourId) : null) || { visited: [], lastPlaceId: null, lang: null });
  const ref = useRef(progress);
  ref.current = progress;

  // Nạp lại khi đổi tour.
  useEffect(() => {
    if (tourId) setProgress(read(tourId) || { visited: [], lastPlaceId: null, lang: null });
  }, [tourId]);

  const persist = useCallback(
    (next) => {
      try {
        if (tourId) localStorage.setItem(KEY(tourId), JSON.stringify(next));
      } catch {
        /* storage không khả dụng — bỏ qua */
      }
    },
    [tourId],
  );

  const markVisited = useCallback(
    (placeId) => {
      setProgress((prev) => {
        const visited = prev.visited.includes(placeId) ? prev.visited : [...prev.visited, placeId];
        const next = { ...prev, visited, lastPlaceId: placeId };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setLang = useCallback(
    (lang) => {
      setProgress((prev) => {
        const next = { ...prev, lang };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    const next = { visited: [], lastPlaceId: null, lang: ref.current.lang };
    setProgress(next);
    persist(next);
  }, [persist]);

  return { progress, markVisited, setLang, reset };
}
