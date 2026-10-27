// =========================================================
// TourPlayerPage — màn hình NGHE TOUR (UC04). Điều phối:
//   - Tải chi tiết tour (UC02 detail: places + route UC11 + ngôn ngữ/TTS UC12).
//   - Mở thẳng theo ?mode=gps|remote (chọn ở chi tiết tour / lịch trình bằng
//     ModePicker) — không còn màn mở đầu thứ hai. ?stop=<id> nghe tại một điểm.
//     Không có ?mode= (link cũ) thì vẫn hiện màn mở đầu để chọn.
//   - Chế độ GPS: bản đồ + vị trí trực tiếp + tự phát theo vùng kích hoạt.
//   - Chế độ nghe thử: chọn điểm thủ công, không cần GPS.
//   - Xử lý E1 (quyền GPS), E2 (GPS yếu), E3 (audio lỗi -> TTS), E4 (offline).
// =========================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { fetchTourDetail } from '../../lib/api.js';
import { densifyPath, haversine } from '../../lib/geo.js';
import { langLabel, formatDistance, formatMinutes, voiceLabel } from '../../lib/format.js';
import { useGeolocation } from '../../hooks/useGeolocation.js';
import { useTourProgress } from '../../hooks/useTourProgress.js';
import { usePlaybackEngine } from '../../hooks/usePlaybackEngine.js';

import Icon from '../../components/Icon.jsx';
import Modal from '../../components/Modal.jsx';
import TourMap from './TourMap.jsx';
import PlayerBar from './PlayerBar.jsx';
import PlaceSheet from './PlaceSheet.jsx';
import PlaceList from './PlaceList.jsx';
import LanguageMenu from './LanguageMenu.jsx';
import SimControls from './SimControls.jsx';
import SimBar, { SIM_SPEEDS } from './SimBar.jsx';
import CompletionDialog from './CompletionDialog.jsx';
import { useBack } from '../../components/shell/AppHeader.jsx';

const STALE_MS = 12000;

// Ghi nhớ tour vừa mở cho HomePage (A4 — quay lại nhanh).
function rememberRecent(id, title) {
  try {
    const key = 'geosound:recent-tours';
    const list = JSON.parse(localStorage.getItem(key) || '[]').filter((r) => r.id !== id);
    list.unshift({ id, title });
    localStorage.setItem(key, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* no-op */
  }
}

/**
 * Trình phát dùng chung cho UC04 (nghe tour) và UC08 (đi theo lịch trình).
 * Nguồn dữ liệu tiêm qua props; mặc định = chi tiết tour công khai (UC04).
 * @param {{
 *   loadDetail?: (lang: string|undefined, opts?: { signal?: AbortSignal }) => Promise<object>,
 *   progressKey?: string,   // khoá lưu tiến độ/ngôn ngữ (mặc định tourId)
 *   backTo?: string,        // nơi quay về khi thoát (mặc định '/')
 *   remember?: boolean,     // ghi "mở gần đây" cho HomePage (chỉ UC04)
 *   modeLabels?: { gps: string, remote: string }, // nhãn chế độ trên topbar
 *   backLabel?: string,     // nhãn nút quay về ở màn lỗi (theo đúng nơi đến)
 *   allowSimulation?: boolean, // hiện công cụ giả lập GPS (xem thử; khách thì cần ?debug=1)
 *   errorActions?: (error: { status?: number, message: string }) => React.ReactNode, // nút riêng ở màn lỗi
 *   editPlaceHref?: (placeId: string) => string, // xem thử: nút "Sửa điểm này" về Studio
 *   completeAction?: { label: string, to: string }, // nút chính ở hộp hoàn thành
 *   freshProgress?: boolean, // xem thử: luôn bắt đầu lại từ đầu (không nhớ điểm đã nghe)
 * }} [props]
 */
export default function TourPlayerPage({
  loadDetail,
  progressKey,
  backTo = '/',
  remember = true,
  modeLabels,
  backLabel = 'Quay lại',
  allowSimulation = false,
  errorActions,
  editPlaceHref,
  completeAction = { label: 'Khám phá tour khác', to: '/' },
  freshProgress = false,
} = {}) {
  const { tourId } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const canSimulate = allowSimulation || sp.get('debug') === '1';
  const back = useBack(backTo);
  const initialMode = ['gps', 'remote'].includes(sp.get('mode')) ? sp.get('mode') : null;
  const stopParam = sp.get('stop');
  const autoStarted = useRef(false);

  const pkey = progressKey ?? tourId;
  const { progress, markVisited, setLang, reset: resetProgress } = useTourProgress(pkey);
  // Xem thử: mỗi lần mở là một lượt mới — không bật "hoàn thành" vì lượt trước.
  useEffect(() => {
    if (freshProgress) resetProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initialLang = sp.get('lang') || progress.lang || undefined;

  const [lang, setLangState] = useState(initialLang);
  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { message, offline, notFound, status }
  const [langBusy, setLangBusy] = useState(false);

  const [mode, setMode] = useState(null); // null(intro) | 'gps' | 'remote'
  const [listOpen, setListOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [showComplete, setShowComplete] = useState(false);
  const [recenterNonce, setRecenterNonce] = useState(0);

  // --- Giả lập GPS (thử nghiệm) ---
  const [simulate, setSimulate] = useState(false);
  const [simPos, setSimPos] = useState(null);
  const [walking, setWalking] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [simSpeed, setSimSpeed] = useState('normal'); // tốc độ đi bộ mô phỏng (xem thử)
  const walkTimer = useRef(null);

  const geo = useGeolocation();

  // ---- Tải dữ liệu (tour hoặc lịch trình) ----
  const load = useCallback(
    async (useLang, { signal } = {}) => {
      if (loadDetail) return loadDetail(useLang, { signal });
      return fetchTourDetail(tourId, useLang, { signal });
    },
    [loadDetail, tourId],
  );

  useEffect(() => {
    let abort = new AbortController();
    setLoading(true);
    setError(null);
    load(lang, { signal: abort.signal })
      .then((t) => {
        setTour(t);
        setLangState(t.selectedLanguage);
        setLang(t.selectedLanguage);
        if (remember && tourId) rememberRecent(tourId, t.title);
      })
      .then(() => setLoading(false))
      .catch((e) => {
        if (e.name === 'AbortError') return; // huỷ do đổi route/StrictMode — giữ loading, KHÔNG set lỗi
        setError({
          message: e.offline ? 'Mất kết nối mạng' : e.status === 404 ? 'Không tìm thấy tour' : e.message,
          offline: e.offline,
          notFound: e.status === 404,
          status: e.status,
        });
        setLoading(false);
      });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  // ---- Vị trí hiệu dụng (thật hoặc giả lập) ----
  const liveStale = geo.position ? Date.now() - geo.position.ts > STALE_MS : false;
  const position = simulate ? simPos : geo.position;
  const userPos = position ? { ...position, stale: !simulate && liveStale } : null;

  // ---- Lõi phát ----
  const onComplete = useCallback(() => setShowComplete(true), []);
  const engine = usePlaybackEngine({
    tour,
    mode,
    position,
    selectedLanguage: tour?.selectedLanguage,
    visited: progress.visited,
    markVisited,
    onComplete,
  });

  const walkPath = useMemo(() => densifyPath(tour?.route?.path ?? [], 14), [tour]);

  const stopWalk = useCallback(() => {
    if (walkTimer.current) {
      clearInterval(walkTimer.current);
      walkTimer.current = null;
    }
    setWalking(false);
  }, []);

  const startWalk = useCallback(() => {
    if (walkPath.length < 2) return;
    setSimulate(true);
    setWalking(true);
    let i = 0;
    setSimPos({ ...walkPath[0], accuracy: 5, ts: Date.now() });
    walkTimer.current = setInterval(() => {
      i += 1;
      if (i >= walkPath.length) {
        stopWalk();
        return;
      }
      setSimPos({ ...walkPath[i], accuracy: 5, ts: Date.now() });
    }, SIM_SPEEDS[simSpeed]?.stepMs ?? 320);
  }, [walkPath, stopWalk, simSpeed]);

  // Đổi tốc độ khi đang đi → đi tiếp từ chỗ hiện tại với nhịp mới.
  const changeSpeed = useCallback(
    (sp) => {
      setSimSpeed(sp);
      if (!walkTimer.current) return;
      clearInterval(walkTimer.current);
      const from = walkPath.findIndex((p) => simPos && p.lat === simPos.lat && p.lng === simPos.lng);
      let i = Math.max(0, from);
      walkTimer.current = setInterval(() => {
        i += 1;
        if (i >= walkPath.length) {
          stopWalk();
          return;
        }
        setSimPos({ ...walkPath[i], accuracy: 5, ts: Date.now() });
      }, SIM_SPEEDS[sp].stepMs);
    },
    [walkPath, simPos, stopWalk],
  );

  useEffect(() => () => stopWalk(), [stopWalk]);

  // ---- Hành động mở đầu ----
  const startGps = useCallback(() => {
    setMode('gps');
    setSheetOpen(false);
    engine.start();
    if (allowSimulation && tour?.places?.[0]) {
      // Xem thử: không cần GPS thật — đứng ở điểm xuất phát, sẵn sàng đi mô phỏng.
      const start = tour.route?.path?.[0] ?? tour.places[0];
      setSimulate(true);
      setSimPos({ lat: start.lat, lng: start.lng, accuracy: 5, ts: Date.now() });
      return;
    }
    if (geo.supported) geo.start();
  }, [engine, geo, allowSimulation, tour]);

  const startRemote = useCallback(
    ({ stop } = {}) => {
      setMode('remote');
      setSheetOpen(true);
      engine.start(); // mở khóa audio; chế độ remote không dùng GPS
      geo.stop();
      setSimulate(false);
      stopWalk();
      if (stop) engine.selectPlace(stop);
      else if (!progress.visited.length) setListOpen(true); // nghe dở → banner "nghe tiếp" thay vì danh sách
    },
    [engine, geo, stopWalk, progress.visited.length],
  );

  // Mở thẳng theo ?mode= (một lần, sau khi tải xong tour).
  useEffect(() => {
    if (!tour || mode || !initialMode || autoStarted.current) return;
    autoStarted.current = true;
    if (initialMode === 'gps') startGps();
    else startRemote({ stop: tour.places.some((p) => p.id === stopParam) ? stopParam : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour]);

  // Trình duyệt chỉ cho phát tiếng sau một thao tác của người dùng: mở khoá
  // audio ở lần chạm đầu tiên trên màn trình phát (mở thẳng không qua nút bấm).
  useEffect(() => {
    if (!mode) return undefined;
    if (navigator.userActivation?.hasBeenActive) engine.audio.unlock();
    const h = () => engine.audio.unlock();
    document.addEventListener('pointerdown', h, { once: true, capture: true });
    return () => document.removeEventListener('pointerdown', h, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // GPS: vào vùng một điểm mới → tự mở sheet nội dung.
  useEffect(() => {
    if (mode === 'gps' && engine.currentPlaceId && engine.currentRole === 'place') setSheetOpen(true);
  }, [mode, engine.currentPlaceId, engine.currentRole]);

  const switchToRemote = useCallback(() => {
    geo.stop();
    setSimulate(false);
    stopWalk();
    setMode('remote');
    setListOpen(true);
  }, [geo, stopWalk]);

  const exit = useCallback(() => {
    engine.stop();
    geo.stop();
    stopWalk();
    back();
  }, [engine, geo, stopWalk, back]);

  // ---- Đổi ngôn ngữ (UC12): tải lại nội dung đã bản địa hóa ----
  const changeLang = useCallback(
    async (code) => {
      setLangBusy(true);
      engine.audio.stop();
      try {
        const t = await load(code);
        setTour(t);
        setLangState(t.selectedLanguage);
        setLang(t.selectedLanguage);
        setSp((prev) => {
          const n = new URLSearchParams(prev);
          n.set('lang', t.selectedLanguage);
          return n;
        });
      } catch (e) {
        /* giữ nội dung cũ nếu lỗi */
      } finally {
        setLangBusy(false);
      }
    },
    [load, setLang, setSp, engine.audio],
  );

  const onSelectFromList = useCallback(
    (placeId) => {
      engine.selectPlace(placeId);
      setListOpen(false);
      setSheetOpen(true);
    },
    [engine],
  );

  const replay = useCallback(() => {
    setShowComplete(false);
    if (engine.ordered[0]) engine.selectPlace(engine.ordered[0].id);
  }, [engine]);

  const visitedSet = useMemo(() => new Set(progress.visited), [progress.visited]);
  const audioError = engine.audio.state.status === 'error';
  useEffect(()=>{if(audioError)setSheetOpen(true);},[audioError]);

  // ---------- Render: tải / lỗi ----------
  if (loading) {
    return (
      <div className="screen screen--center">
        <Icon name="loader" size={36} className="spin" />
        <p className="muted">Đang tải tour…</p>
      </div>
    );
  }
  if (error) {
    const custom = errorActions?.(error);
    // Thử lại chỉ có ích với lỗi mạng / máy chủ; 4xx (thiếu dữ liệu, không có quyền…) thì vô ích.
    const retryable = error.offline || !error.status || error.status >= 500;
    return (
      <div className="screen screen--center">
        <div className="emptybox">
          <Icon name={error.offline ? 'wifi-off' : 'alert-triangle'} size={40} />
          <h2>{error.message}</h2>
          {!custom ? (
            <p className="muted">
              {error.offline
                ? 'Tour chưa tải về sẽ cần có mạng. Hãy kiểm tra kết nối rồi thử lại.'
                : error.notFound
                  ? 'Tour không tồn tại hoặc chưa công khai.'
                  : 'Đã có lỗi khi tải tour.'}
            </p>
          ) : null}
          <div className="row">
            <button className="btn btn--ghost" onClick={() => navigate(backTo)}>
              <Icon name="arrow-left" size={16} /> {backLabel}
            </button>
            {custom ??
              (retryable ? (
                <button className="btn btn--primary" onClick={() => window.location.reload()}>
                  Thử lại
                </button>
              ) : null)}
          </div>
        </div>
      </div>
    );
  }

  if (!tour) return null; // phòng hờ: không loading, không lỗi, chưa có dữ liệu (tránh crash null)

  // ---------- Render: màn hình mở đầu ----------
  if (!mode) {
    const hasRoute = (tour.route?.path?.length ?? 0) > 1;
    const resume = progress.visited.length > 0 && progress.visited.length < tour.places.length;
    return (
      <div className="screen intro">
        <div className="intro__cover" style={tour.coverImageUrl ? { backgroundImage: `url(${tour.coverImageUrl})` } : undefined}>
          <div className="intro__cover-grad" />
          <button className="iconbtn intro__back" onClick={back} aria-label="Quay lại">
            <Icon name="arrow-left" size={20} />
          </button>
        </div>

        <div className="intro__body">
          <h1 className="intro__title">{tour.title}</h1>
          <div className="intro__chips">
            {tour.city ? <span className="chip"><Icon name="map-pin" size={13} /> {tour.city}</span> : null}
            <span className="chip"><Icon name="list" size={13} /> {tour.placeCount} điểm</span>
            {tour.duration ? <span className="chip">{formatMinutes(tour.duration)}</span> : null}
            <span className="chip" title={voiceLabel(tour.voiceLabel)}><Icon name="languages" size={13} /> {langLabel(tour.selectedLanguage)}</span>
          </div>
          {tour.description ? <p className="intro__desc">{tour.description}</p> : null}

          {resume ? (
            <div className="alert" role="status">
              <Icon name="info" size={18} />
              <div>Bạn đang nghe dở tour này ({progress.visited.length}/{tour.places.length} điểm). Tiếp tục ngay nhé.</div>
            </div>
          ) : null}

          {!tour.places.length ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>Tour này chưa có điểm nào để nghe.</div>
            </div>
          ) : (
            <div className="intro__actions">
              <button className="btn btn--primary btn--lg btn--block" onClick={startGps} disabled={!hasRoute && !tour.places.length}>
                <Icon name="navigation" size={18} /> Bắt đầu tour (theo GPS)
              </button>
              <button className="btn btn--lg btn--block" onClick={() => startRemote()}>
                <Icon name="headphones" size={18} /> Nghe thử từ xa
              </button>
              {!hasRoute ? (
                <p className="muted small">Tour chưa có route đầy đủ — bạn vẫn có thể nghe thử từng điểm.</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- Render: đang nghe ----------
  const showGpsDenied = mode === 'gps' && !simulate && (geo.permission === 'denied' || geo.permission === 'unsupported');
  const showLowAcc = mode === 'gps' && !simulate && geo.lowAccuracy && geo.permission === 'granted';
  const showStale = mode === 'gps' && !simulate && userPos?.stale;

  // Điểm tiếp theo chưa nghe (theo thứ tự) + khoảng cách từ vị trí hiện tại.
  const nextPlace = engine.ordered.find((p) => !visitedSet.has(p.id) && p.id !== engine.currentPlaceId) || null;
  const nextDistance = nextPlace && userPos && Number.isFinite(nextPlace.lat) ? haversine(userPos, nextPlace) : null;
  const nextIndex = nextPlace ? engine.ordered.indexOf(nextPlace) + 1 : 0;
  const resumeAt = !engine.currentPlaceId && progress.visited.length > 0 && nextPlace ? nextPlace : null;

  return (
    <div className="screen player-screen">
      <header className="topbar">
        <button className="iconbtn" onClick={exit} aria-label="Thoát tour">
          <Icon name="arrow-left" size={20} />
        </button>
        <div className="topbar__title">
          <span className="topbar__name" title={tour.title}>{tour.title}</span>
          <span className="topbar__mode">{mode === 'gps' ? modeLabels?.gps ?? 'Đi theo GPS' : modeLabels?.remote ?? 'Nghe thử từ xa'}</span>
        </div>
        <div className="topbar__actions">
          <LanguageMenu
            languages={tour.availableLanguages}
            selected={tour.selectedLanguage}
            voiceLabel={voiceLabel(tour.voiceLabel)}
            onChange={changeLang}
            busy={langBusy}
          />
          <button className="iconbtn" onClick={() => setListOpen(true)} aria-label="Danh sách điểm">
            <Icon name="list" size={20} />
          </button>
        </div>
      </header>

      <div className="stage">
        <TourMap
          tour={tour}
          activePlaceId={engine.currentPlaceId}
          visitedIds={visitedSet}
          userPos={userPos}
          follow={mode === 'gps'}
          simulate={simulate}
          recenterNonce={recenterNonce}
          onSelectPlace={(id) => engine.selectPlace(id)}
          onSimPick={(p) => setSimPos({ ...p, accuracy: 5, ts: Date.now() })}
        />

        {/* Băng cảnh báo GPS (E1/E2) */}
        <div className="banners">
          {showGpsDenied ? (
            <div className="alert alert--warn banner" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div className="banner__text">
                <div className="alert__title">{geo.permission === 'unsupported' ? 'Thiết bị không hỗ trợ GPS' : 'Chưa có quyền vị trí'}</div>
                Hãy cấp quyền vị trí, hoặc chuyển sang nghe thử từ xa.
              </div>
              <button className="btn" onClick={switchToRemote}>Nghe thử</button>
            </div>
          ) : null}
          {showLowAcc ? (
            <div className="alert banner" role="status">
              <Icon name="info" size={18} />
              <div className="banner__text">GPS yếu (±{formatDistance(geo.position.accuracy)}). Bạn có thể chọn điểm thủ công.</div>
            </div>
          ) : null}
          {showStale ? (
            <div className="alert banner" role="status">
              <Icon name="info" size={18} />
              <div className="banner__text">Tín hiệu vị trí chưa cập nhật. Đang chờ GPS…</div>
            </div>
          ) : null}
          {resumeAt ? (
            <div className="alert banner" role="status">
              <Icon name="headphones" size={18} />
              <div className="banner__text">
                Bạn đã nghe {progress.visited.length}/{tour.places.length} điểm.
              </div>
              <button className="btn btn--primary btn--sm" onClick={() => engine.selectPlace(resumeAt.id)}>
                Nghe tiếp điểm {nextIndex}
              </button>
            </div>
          ) : null}
          {mode === 'gps' && !resumeAt && nextPlace && !showGpsDenied ? (
            <div className="nextcard" role="status">
              <span className="nextcard__num">{nextIndex}</span>
              <span className="nextcard__text">
                <span className="nextcard__label">Tiếp theo</span>
                <b>{nextPlace.name}</b>
              </span>
              {nextDistance !== null ? <span className="nextcard__dist">{formatDistance(nextDistance)}</span> : null}
            </div>
          ) : null}
        </div>

        {/* Nút nổi bên phải */}
        <div className="fabs">
          {mode === 'gps' ? (
            <button className="iconbtn" onClick={() => setRecenterNonce((n) => n + 1)} aria-label="Về vị trí của tôi" disabled={!userPos}>
              <Icon name="crosshair" size={20} />
            </button>
          ) : null}
        </div>

        {mode === 'gps' && allowSimulation ? (
          <SimBar
            walking={walking}
            onWalk={() => (walking ? stopWalk() : startWalk())}
            canWalk={walkPath.length > 1}
            speed={simSpeed}
            onSpeed={changeSpeed}
          />
        ) : mode === 'gps' && canSimulate ? (
          <SimControls
            simulate={simulate}
            onToggle={(v) => {
              setSimulate(v);
              if (v && !simPos && tour.places[0]) setSimPos({ lat: tour.places[0].lat, lng: tour.places[0].lng, accuracy: 5, ts: Date.now() });
              if (!v) stopWalk();
            }}
            walking={walking}
            onWalk={() => (walking ? stopWalk() : startWalk())}
            canWalk={walkPath.length > 1}
            open={simOpen}
            onToggleOpen={() => setSimOpen((v) => !v)}
          />
        ) : null}
      </div>

      <div className="dock">
        <PlaceSheet
          editHref={editPlaceHref && engine.currentPlace ? editPlaceHref(engine.currentPlace.id) : null}
          place={engine.currentPlace}
          number={engine.ordered.findIndex((p) => p.id === engine.currentPlaceId) + 1 || undefined}
          role={engine.currentRole}
          expanded={sheetOpen}
          onToggle={() => setSheetOpen((v) => !v)}
          audioError={audioError}
        />
        <PlayerBar audio={engine.audio} engine={engine} hideTitle={sheetOpen && !!engine.currentPlace && engine.currentRole === 'place'} />
      </div>

      {/* Danh sách điểm (A3 / A5) */}
      <Modal open={listOpen} onClose={() => setListOpen(false)} title="Các điểm dừng">
        <PlaceList
          places={engine.ordered}
          currentPlaceId={engine.currentPlaceId}
          visitedIds={visitedSet}
          onSelect={onSelectFromList}
        />
      </Modal>

      <CompletionDialog
        open={showComplete}
        onClose={() => setShowComplete(false)}
        onReplay={replay}
        onExplore={() => navigate(completeAction.to)}
        exploreLabel={completeAction.label}
        tourTitle={tour.title}
        placeCount={tour.placeCount}
      />
    </div>
  );
}
