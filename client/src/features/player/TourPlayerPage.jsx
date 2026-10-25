// =========================================================
// TourPlayerPage — màn hình NGHE TOUR (UC04). Điều phối:
//   - Tải chi tiết tour (UC02 detail: places + route UC11 + ngôn ngữ/TTS UC12).
//   - Màn hình mở đầu: "Bắt đầu tour" (GPS) hoặc "Nghe thử từ xa" (A5).
//   - Chế độ GPS: bản đồ + vị trí trực tiếp + tự phát theo vùng kích hoạt.
//   - Chế độ nghe thử: chọn điểm thủ công, không cần GPS.
//   - Xử lý E1 (quyền GPS), E2 (GPS yếu), E3 (audio lỗi -> TTS), E4 (offline).
// =========================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { fetchTourDetail } from '../../lib/api.js';
import { densifyPath } from '../../lib/geo.js';
import { langLabel, formatDistance } from '../../lib/format.js';
import { useGeolocation } from '../../hooks/useGeolocation.js';
import { useTourProgress } from '../../hooks/useTourProgress.js';
import { usePlaybackEngine } from '../../hooks/usePlaybackEngine.js';
import { useTheme } from '../../hooks/useTheme.js';

import Icon from '../../components/Icon.jsx';
import Modal from '../../components/Modal.jsx';
import TourMap from './TourMap.jsx';
import PlayerBar from './PlayerBar.jsx';
import PlaceSheet from './PlaceSheet.jsx';
import PlaceList from './PlaceList.jsx';
import LanguageMenu from './LanguageMenu.jsx';
import SimControls from './SimControls.jsx';
import CompletionDialog from './CompletionDialog.jsx';

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
 * }} [props]
 */
export default function TourPlayerPage({ loadDetail, progressKey, backTo = '/', remember = true, modeLabels } = {}) {
  const { tourId } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { isDark, toggle: toggleTheme } = useTheme();

  const pkey = progressKey ?? tourId;
  const { progress, markVisited, setLang } = useTourProgress(pkey);
  const initialLang = sp.get('lang') || progress.lang || undefined;

  const [lang, setLangState] = useState(initialLang);
  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { message, offline, notFound }
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
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setError({
          message: e.offline ? 'Mất kết nối mạng' : e.status === 404 ? 'Không tìm thấy tour' : e.message,
          offline: e.offline,
          notFound: e.status === 404,
        });
      })
      .finally(() => setLoading(false));
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
    }, 320);
  }, [walkPath, stopWalk]);

  useEffect(() => () => stopWalk(), [stopWalk]);

  // ---- Hành động mở đầu ----
  const startGps = useCallback(() => {
    setMode('gps');
    setSheetOpen(true);
    engine.start();
    if (geo.supported) geo.start();
  }, [engine, geo]);

  const startRemote = useCallback(() => {
    setMode('remote');
    setListOpen(true);
    setSheetOpen(true);
    engine.start(); // mở khóa audio; chế độ remote không dùng GPS
    geo.stop();
    setSimulate(false);
    stopWalk();
  }, [engine, geo, stopWalk]);

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
    navigate(backTo);
  }, [engine, geo, stopWalk, navigate, backTo]);

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
    return (
      <div className="screen screen--center">
        <div className="emptybox">
          <Icon name={error.offline ? 'wifi-off' : 'alert-triangle'} size={40} />
          <h2>{error.message}</h2>
          <p className="muted">
            {error.offline
              ? 'Tour chưa tải về sẽ cần có mạng. Hãy kiểm tra kết nối rồi thử lại.'
              : error.notFound
                ? 'Tour không tồn tại hoặc chưa công khai.'
                : 'Đã có lỗi khi tải tour.'}
          </p>
          <div className="row">
            <button className="btn btn--ghost" onClick={() => navigate(backTo)}>
              <Icon name="arrow-left" size={16} /> Về trang chủ
            </button>
            <button className="btn btn--primary" onClick={() => window.location.reload()}>
              Thử lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Render: màn hình mở đầu ----------
  if (!mode) {
    const hasRoute = (tour.route?.path?.length ?? 0) > 1;
    const resume = progress.visited.length > 0 && progress.visited.length < tour.places.length;
    return (
      <div className="screen intro">
        <div className="intro__cover" style={tour.coverImageUrl ? { backgroundImage: `url(${tour.coverImageUrl})` } : undefined}>
          <div className="intro__cover-grad" />
          <button className="iconbtn intro__back" onClick={() => navigate(backTo)} aria-label="Quay lại">
            <Icon name="arrow-left" size={20} />
          </button>
          <button className="iconbtn intro__theme" onClick={toggleTheme} aria-label="Đổi giao diện sáng/tối">
            <Icon name={isDark ? 'sun' : 'moon'} size={18} />
          </button>
        </div>

        <div className="intro__body">
          <h1 className="intro__title">{tour.title}</h1>
          <div className="intro__chips">
            {tour.city ? <span className="chip"><Icon name="map-pin" size={13} /> {tour.city}</span> : null}
            <span className="chip"><Icon name="list" size={13} /> {tour.placeCount} điểm</span>
            {tour.duration ? <span className="chip">{tour.duration} phút</span> : null}
            <span className="chip" title={tour.voiceLabel}><Icon name="languages" size={13} /> {langLabel(tour.selectedLanguage)}</span>
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
              <button className="btn btn--lg btn--block" onClick={startRemote}>
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
            voiceLabel={tour.voiceLabel}
            onChange={changeLang}
            busy={langBusy}
          />
          <button className="iconbtn" onClick={() => setListOpen(true)} aria-label="Danh sách điểm">
            <Icon name="list" size={20} />
          </button>
          <button className="iconbtn" onClick={toggleTheme} aria-label="Đổi giao diện sáng/tối">
            <Icon name={isDark ? 'sun' : 'moon'} size={18} />
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
        </div>

        {/* Nút nổi bên phải */}
        <div className="fabs">
          {mode === 'gps' ? (
            <button className="iconbtn" onClick={() => setRecenterNonce((n) => n + 1)} aria-label="Về vị trí của tôi" disabled={!userPos}>
              <Icon name="crosshair" size={20} />
            </button>
          ) : null}
        </div>

        {mode === 'gps' ? (
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
          place={engine.currentPlace}
          role={engine.currentRole}
          expanded={sheetOpen}
          onToggle={() => setSheetOpen((v) => !v)}
          audioError={audioError}
        />
        <PlayerBar audio={engine.audio} engine={engine} />
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
        tourTitle={tour.title}
        placeCount={tour.placeCount}
      />
    </div>
  );
}
