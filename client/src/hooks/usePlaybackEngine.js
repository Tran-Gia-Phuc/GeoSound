// =========================================================
// usePlaybackEngine — lõi runtime nghe tour (UC04).
// Nhận cấu hình tour (places + route UC11) + vị trí hiện tại, quyết định
// phát audio gì:
//   - Vào vùng kích hoạt -> tự phát điểm (bước 6-8).
//   - Chồng vùng -> điểm ưu tiên cao nhất (A1).
//   - Đang phát mà vào vùng khác -> ưu tiên cao chen ngang, thấp chờ (A2).
//   - Hết điểm -> phát gợi ý "đi tiếp" nếu có (bước 11).
//   - Vào vùng chỉ đường -> phát audio chỉ đường (bước 9-10).
//   - Chọn điểm thủ công (A3) / chế độ nghe thử (A5) -> phát trực tiếp.
//   - Nghe hết các điểm -> báo hoàn thành (bước 14).
// Sở hữu luôn useAudioController để nối chuỗi "ended" gọn gàng.
// =========================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioController } from './useAudioController.js';
import { triggersAt, navAudiosAt } from '../lib/zones.js';

const BUSY = new Set(['playing', 'paused', 'loading']);

export function usePlaybackEngine({ tour, mode, position, selectedLanguage, visited, markVisited, onComplete }) {
  const places = tour?.places ?? [];
  const triggers = tour?.route?.triggers ?? [];
  const navAudios = tour?.route?.navAudios ?? [];

  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const triggerByPlace = useMemo(() => new Map(triggers.map((t) => [t.placeId, t])), [triggers]);
  const ordered = useMemo(() => [...places].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)), [places]);

  const [currentPlaceId, setCurrentPlaceId] = useState(null);
  const [currentRole, setCurrentRole] = useState(null); // place|hint|nav
  const [active, setActive] = useState(false); // engine GPS đang chạy

  const endedHandler = useRef(() => {});
  const audio = useAudioController({ onEnded: () => endedHandler.current() });

  // Refs trạng thái (đọc trong vòng đánh giá vị trí, tránh lệ thuộc render).
  const metaRef = useRef({ role: null, placeId: null, priority: -Infinity, manual: false });
  const insideRef = useRef(new Set()); // placeId vùng kích hoạt đang đứng trong
  const navInsideRef = useRef(new Set()); // id vùng chỉ đường đang đứng trong
  const pendingRef = useRef(null); // trigger bị hoãn do ưu tiên thấp (A2)
  const statusRef = useRef('idle');
  const lastPosRef = useRef(null);
  const activeRef = useRef(false);
  const modeRef = useRef(mode);
  const langRef = useRef(selectedLanguage);
  const visitedRef = useRef(new Set(visited || []));

  activeRef.current = active;
  modeRef.current = mode;
  langRef.current = selectedLanguage;
  useEffect(() => {
    statusRef.current = audio.state.status;
  }, [audio.state.status]);
  useEffect(() => {
    visitedRef.current = new Set(visited || []);
  }, [visited]);

  const isBusy = () => metaRef.current.role !== null && BUSY.has(statusRef.current);

  const setCurrent = useCallback((role, placeId) => {
    setCurrentRole(role);
    if (placeId !== undefined) setCurrentPlaceId(placeId);
  }, []);

  // ---- Phát một điểm ----
  const playPlace = useCallback(
    (placeId, { manual = false } = {}) => {
      const place = placeById.get(placeId);
      if (!place) return;
      const trig = triggerByPlace.get(placeId);
      metaRef.current = { role: 'place', placeId, priority: trig?.priority ?? 0, manual };
      setCurrent('place', placeId);
      audio.playTrack({
        src: place.audioUrl,
        text: place.text,
        lang: langRef.current,
        title: place.name,
        id: place.id,
      });
    },
    [placeById, triggerByPlace, audio, setCurrent],
  );

  const playNav = useCallback(
    (nav) => {
      metaRef.current = { role: 'nav', placeId: null, priority: -Infinity, manual: false };
      setCurrent('nav');
      audio.playTrack({
        src: nav.audioUrl,
        text: nav.text || nav.label,
        lang: langRef.current,
        title: nav.label || 'Chỉ đường',
        id: `nav:${nav.id}`,
      });
    },
    [audio, setCurrent],
  );

  const allVisited = useCallback(
    () => ordered.length > 0 && ordered.every((p) => visitedRef.current.has(p.id)),
    [ordered],
  );

  // Sau khi phát xong nội dung điểm (+ gợi ý): kiểm tra hoàn thành / phần chờ.
  const afterContentDone = useCallback(() => {
    metaRef.current = { role: null, placeId: null, priority: -Infinity, manual: false };
    setCurrentRole(null);
    if (allVisited()) {
      onComplete?.();
      return;
    }
    // A2: điểm bị hoãn, nếu còn đứng trong vùng của nó -> phát tiếp.
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending && activeRef.current && modeRef.current === 'gps' && insideRef.current.has(pending.placeId)) {
      playPlace(pending.placeId);
    }
  }, [allVisited, onComplete, playPlace]);

  // Xử lý khi một track phát xong.
  endedHandler.current = useCallback(() => {
    const meta = metaRef.current;
    if (meta.role === 'place' && meta.placeId) {
      markVisited(meta.placeId);
      visitedRef.current.add(meta.placeId);
      const trig = triggerByPlace.get(meta.placeId);
      const hint = trig?.nextHint;
      // Gợi ý "đi tiếp" chỉ ở chế độ đi thực địa và không phải chọn thủ công.
      if (!meta.manual && modeRef.current === 'gps' && hint && (hint.text || hint.audioUrl)) {
        const place = placeById.get(meta.placeId);
        metaRef.current = { role: 'hint', placeId: meta.placeId, priority: -Infinity, manual: false };
        setCurrentRole('hint');
        audio.playTrack({
          src: hint.audioUrl,
          text: hint.text,
          lang: langRef.current,
          title: `Đi tiếp — ${place?.name ?? ''}`.trim(),
          id: `hint:${meta.placeId}`,
        });
        return;
      }
      afterContentDone();
    } else if (meta.role === 'hint') {
      afterContentDone();
    } else {
      // Xong audio chỉ đường.
      metaRef.current = { role: null, placeId: null, priority: -Infinity, manual: false };
      setCurrentRole(null);
    }
  }, [markVisited, triggerByPlace, placeById, audio, afterContentDone]);

  // ---- Đánh giá vị trí (GPS) ----
  const evaluate = useCallback(
    (pos) => {
      lastPosRef.current = pos;
      if (!activeRef.current || modeRef.current !== 'gps' || !pos) return;

      // Vùng kích hoạt điểm.
      const curTriggers = triggersAt(pos, triggers); // đã sắp theo ưu tiên giảm
      const nowInside = new Set(curTriggers.map((t) => t.placeId));
      const prevInside = insideRef.current;
      const newlyEntered = curTriggers.filter((t) => !prevInside.has(t.placeId));
      insideRef.current = nowInside;

      if (newlyEntered.length) {
        const cand = newlyEntered[0]; // ưu tiên cao nhất vừa vào
        if (!isBusy()) {
          playPlace(cand.placeId);
        } else if (cand.priority > metaRef.current.priority && cand.placeId !== metaRef.current.placeId) {
          playPlace(cand.placeId); // A2: ưu tiên cao -> chen ngang
        } else {
          pendingRef.current = cand; // A2: ưu tiên thấp -> chờ
        }
      }

      // Vùng chỉ đường (ngã rẽ).
      const navHere = navAudiosAt(pos, navAudios);
      const nowNav = new Set(navHere.map((n) => n.id));
      const newlyNav = navHere.filter((n) => !navInsideRef.current.has(n.id));
      navInsideRef.current = nowNav;
      if (newlyNav.length && !isBusy()) {
        playNav(newlyNav[0]);
      }
    },
    [triggers, navAudios, playPlace, playNav],
  );

  // Chạy đánh giá mỗi khi vị trí đổi.
  useEffect(() => {
    if (position) evaluate(position);
  }, [position, evaluate]);

  // ---- Điều khiển công khai ----
  const start = useCallback(() => {
    audio.unlock();
    insideRef.current = new Set();
    navInsideRef.current = new Set();
    pendingRef.current = null;
    setActive(true);
    activeRef.current = true;
    // Nếu đã có vị trí & đang đứng trong vùng -> phát ngay.
    if (lastPosRef.current) evaluate(lastPosRef.current);
  }, [audio, evaluate]);

  const stop = useCallback(() => {
    setActive(false);
    activeRef.current = false;
    audio.stop();
    metaRef.current = { role: null, placeId: null, priority: -Infinity, manual: false };
    setCurrentRole(null);
  }, [audio]);

  // A3 / A5: chọn điểm thủ công (không cần vùng).
  const selectPlace = useCallback(
    (placeId) => {
      audio.unlock();
      pendingRef.current = null;
      playPlace(placeId, { manual: true });
    },
    [audio, playPlace],
  );

  // Điều hướng tuần tự (thanh phát + chế độ nghe thử).
  const step = useCallback(
    (dir) => {
      if (!ordered.length) return;
      const idx = ordered.findIndex((p) => p.id === currentPlaceId);
      const nextIdx = idx < 0 ? (dir > 0 ? 0 : ordered.length - 1) : idx + dir;
      if (nextIdx < 0 || nextIdx >= ordered.length) return;
      selectPlace(ordered[nextIdx].id);
    },
    [ordered, currentPlaceId, selectPlace],
  );

  const currentPlace = currentPlaceId ? placeById.get(currentPlaceId) : null;
  const canPrev = ordered.findIndex((p) => p.id === currentPlaceId) > 0;
  const canNext = (() => {
    const i = ordered.findIndex((p) => p.id === currentPlaceId);
    return i >= 0 && i < ordered.length - 1;
  })();

  return {
    audio,
    active,
    currentPlaceId,
    currentPlace,
    currentRole,
    ordered,
    start,
    stop,
    selectPlace,
    next: () => step(1),
    prev: () => step(-1),
    canPrev,
    canNext,
  };
}
