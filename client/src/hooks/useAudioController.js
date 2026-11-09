// =========================================================
// useAudioController — một "đầu phát" duy nhất cho UC04.
// Hai nguồn phát hợp nhất:
//   - kind:'url' : audio người thật / TTS đã render (HTMLAudioElement)
//   - kind:'tts' : đọc text bằng SpeechSynthesis của trình duyệt (fallback E3,
//                  và cho URL giả lập 'tts://' của UC12 lúc dev — chạy offline)
// Luật E3: URL hỏng/thiếu -> tự chuyển sang đọc TTS từ text; vẫn lỗi -> báo lỗi,
// màn hình vẫn hiển thị text (do component xử lý).
// =========================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeUtterance, pauseStopsSpeech } from '../lib/speech.js';
import { beatPresence, setMediaPlaying } from '../lib/presence.js';

const isPlayableUrl = (src) => typeof src === 'string' && /^(https?:|blob:|data:|\/)/.test(src);

export function useAudioController({ onEnded } = {}) {
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const audioRef = useRef(null);
  const requestedTrack = useRef(null);
  const playGeneration = useRef(0);
  const retryPending = useRef(false);
  const lastPosition = useRef({ trackId: null, time: 0 });
  const trackRef = useRef(null); // track đang phát (để biết nguồn khi 'ended')
  const endedRef = useRef(onEnded);
  const ttsKeepAlive = useRef(null);
  const ttsStart = useRef(0);
  const activeUtter = useRef(null); // phân biệt callback cũ sau khi cancel()
  const ttsSpoken = useRef(0); // #263: index in the track text of the last word reached
  const ttsElapsed = useRef(0); // #263: seconds already spoken when paused
  // #263: on Android Chrome speechSynthesis.pause() ends the utterance; pause = cancel, resume = speak the rest.
  const pauseEndsTts = useMemo(() => pauseStopsSpeech(), []);

  endedRef.current = onEnded;

  const [state, setState] = useState({
    status: 'idle', // idle|loading|playing|paused|ended|error
    currentTime: 0,
    duration: 0,
    canSeek: false,
    usingTts: false,
    fellBack: false, // true khi URL hỏng phải lùi về TTS
    title: '',
    trackId: null,
    ttsError: null, // #263: SpeechSynthesisErrorEvent.error of the last failed utterance
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  // #329 — while a track plays this device stays "online" for the admin view, even with the tab
  // hidden (screen locked); the beats themselves are throttled to one a minute.
  const presenceKey = useRef({});
  const isPlaying = state.status === 'playing';
  useEffect(() => {
    if (!isPlaying) return undefined;
    const key = presenceKey.current;
    setMediaPlaying(key, true);
    beatPresence();
    return () => setMediaPlaying(key, false);
  }, [isPlaying]);

  // Tạo audio element một lần.
  if (audioRef.current === null && typeof Audio !== 'undefined') {
    audioRef.current = new Audio();
    audioRef.current.preload = 'auto';
  }

  const patch = useCallback((p) => setState((s) => ({ ...s, ...p })), []);

  const clearTts = useCallback(() => {
    if (ttsKeepAlive.current) {
      clearInterval(ttsKeepAlive.current);
      ttsKeepAlive.current = null;
    }
    activeUtter.current = null; // vô hiệu hóa callback của utterance cũ
    if (ttsSupported) window.speechSynthesis.cancel();
  }, [ttsSupported]);

  const handleEnded = useCallback(() => {
    patch({ status: 'ended' });
    const t = trackRef.current;
    endedRef.current?.(t);
  }, [patch]);

  // Gắn sự kiện cho HTMLAudioElement.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      if (trackRef.current?.kind === 'url' && Number.isFinite(a.currentTime)) {
        lastPosition.current = { trackId: trackRef.current.id ?? null, time: a.currentTime };
      }
      patch({ currentTime: a.currentTime });
      if (!a.paused) beatPresence(); // timeupdate keeps firing in a background tab while audio plays
    };
    const onMeta = () =>
      patch({ duration: Number.isFinite(a.duration) ? a.duration : 0, canSeek: a.seekable.length > 0 });
    const onPlay = () => patch({ status: 'playing' });
    const onPause = () => {
      if (!a.ended) patch({ status: 'paused' });
    };
    const onEnd = () => {
      if (trackRef.current?.kind === 'url') handleEnded();
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('playing', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('playing', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnd);
    };
  }, [patch, handleEnded]);

  // ---- Đọc TTS bằng SpeechSynthesis ----
  // Speaks `text` from character `from` (0 = start; > 0 = resume on Android, #263).
  const utter = useCallback(
    (text, lang, from = 0) => {
      const u = makeUtterance(from > 0 ? text.slice(from) : text, lang);
      u.rate = 1;
      activeUtter.current = u;
      ttsSpoken.current = from;
      u.onboundary = (e) => {
        if (activeUtter.current === u && Number.isFinite(e?.charIndex)) ttsSpoken.current = from + e.charIndex;
      };
      u.onend = () => {
        if (activeUtter.current !== u) return; // callback của lần phát đã bị thay
        if (ttsKeepAlive.current) clearInterval(ttsKeepAlive.current);
        handleEnded();
      };
      u.onerror = (e) => {
        if (activeUtter.current !== u) return; // bỏ qua lỗi do cancel()
        if (ttsKeepAlive.current) clearInterval(ttsKeepAlive.current);
        patch({ status: 'error', ttsError: e?.error || 'synthesis-failed' });
      };
      window.speechSynthesis.speak(u);
      // Desktop Chrome stops long texts midway unless pause/resume is called regularly; on Android
      // that call ends the speech (#263), so there only the estimated progress is updated.
      ttsKeepAlive.current = setInterval(() => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          if (!pauseEndsTts) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          }
          patch({ currentTime: (Date.now() - ttsStart.current) / 1000 });
          beatPresence(); // #329, throttled
        }
      }, 1000);
    },
    [patch, handleEnded, pauseEndsTts],
  );

  const speak = useCallback(
    (text, lang, { fellBack = false, title = '', trackId = null } = {}) => {
      clearTts();
      if (audioRef.current) audioRef.current.pause();
      if (!ttsSupported || !text) {
        patch({ status: 'error', usingTts: true, fellBack, title, trackId });
        return false;
      }
      trackRef.current = { kind: 'tts', text, lang, title, trackId };
      ttsStart.current = Date.now();
      patch({
        status: 'playing',
        usingTts: true,
        fellBack,
        canSeek: false,
        duration: estimateTtsDuration(text),
        currentTime: 0,
        title,
        trackId,
        ttsError: null,
      });
      utter(text, lang, 0);
      return true;
    },
    [clearTts, ttsSupported, patch, utter],
  );

  /**
   * Phát một track.
   * @param {{ kind?:'url'|'tts', src?:string, text?:string, lang?:string,
   *           title?:string, id?:string }} track
   */
  const playTrack = useCallback(
    (track, options = {}) => {
      if (!track) return;
      const generation = ++playGeneration.current;
      retryPending.current = !!options.retry;
      requestedTrack.current = { ...track };
      const title = track.title || '';
      const trackId = track.id ?? null;
      const restoreTime = options.retry && trackId !== null && lastPosition.current.trackId === trackId ? lastPosition.current.time : 0;
      if (!options.retry) lastPosition.current = { trackId, time: 0 };
      // URL thật -> thử phát; lỗi thì lùi TTS (E3).
      if (isPlayableUrl(track.src)) {
        clearTts();
        const a = audioRef.current;
        trackRef.current = { kind: 'url', ...track };
        patch({
          status: 'loading',
          usingTts: false,
          fellBack: false,
          canSeek: false,
          currentTime: 0,
          duration: 0,
          title,
          trackId,
        });
        a.muted = false;
        let failed = false;
        const fail = () => {
          if (generation !== playGeneration.current || failed) return;
          failed = true;
          retryPending.current = false;
          if (Number.isFinite(a.currentTime) && a.currentTime > 0) lastPosition.current = { trackId, time: a.currentTime };
          if (track.text) speak(track.text, track.lang, { fellBack: true, title, trackId });
          else patch({ status: 'error', title, trackId });
        };
        a.onloadedmetadata = () => {
          if (generation !== playGeneration.current || !restoreTime) return;
          try {
            if (a.seekable.length) {
              const start = a.seekable.start(0), end = a.seekable.end(a.seekable.length - 1);
              if (restoreTime >= start && restoreTime <= end) a.currentTime = restoreTime;
            }
          } catch { /* Source is not seekable; play from the available position. */ }
        };
        a.onerror = fail;
        a.src = track.src;
        a.play().then(() => { if (generation === playGeneration.current) retryPending.current = false; }).catch(fail);
        return;
      }
      // Không có URL phát được (null hoặc 'tts://...') -> đọc text.
      retryPending.current = false;
      speak(track.text, track.lang, { fellBack: false, title, trackId });
    },
    [clearTts, patch, speak],
  );

  const retry = useCallback(() => {
    if (requestedTrack.current && !retryPending.current) playTrack(requestedTrack.current, { retry: true });
  }, [playTrack]);

  const pause = useCallback(() => {
    if (trackRef.current?.kind === 'tts') {
      ttsElapsed.current = (Date.now() - ttsStart.current) / 1000;
      if (ttsSupported) {
        if (pauseEndsTts) clearTts(); // #263: stop; resume speaks the rest from ttsSpoken
        else window.speechSynthesis.pause();
      }
      patch({ status: 'paused' });
    } else {
      audioRef.current?.pause();
    }
  }, [patch, ttsSupported, pauseEndsTts, clearTts]);

  const resume = useCallback(() => {
    const t = trackRef.current;
    if (t?.kind === 'tts') {
      ttsStart.current = Date.now() - ttsElapsed.current * 1000;
      if (ttsSupported) {
        if (pauseEndsTts) utter(t.text, t.lang, ttsSpoken.current);
        else window.speechSynthesis.resume();
      }
      patch({ status: 'playing' });
    } else {
      audioRef.current?.play().catch(() => {});
    }
  }, [patch, ttsSupported, pauseEndsTts, utter]);

  // Reads the status from a ref, not inside a setState updater: StrictMode runs updaters twice,
  // which would speak the rest twice on Android (#263).
  const toggle = useCallback(() => {
    const status = stateRef.current.status;
    if (status === 'playing') pause();
    else if (status === 'paused') resume();
  }, [pause, resume]);

  // #300: the new position goes into state at once. Waiting for 'timeupdate' let React restore the
  // controlled range to the old time, and the range's trailing 'change' event then seeked back there.
  const seek = useCallback((sec) => {
    const a = audioRef.current;
    if (trackRef.current?.kind === 'url' && a && a.seekable.length > 0 && Number.isFinite(a.duration)) {
      const time = Math.max(0, Math.min(Number(sec) || 0, a.duration));
      a.currentTime = time;
      lastPosition.current = { trackId: trackRef.current.id ?? null, time };
      patch({ currentTime: time });
    }
  }, [patch]);

  // Relative seek (±15 s buttons) from the media element's real time, not the last rendered state.
  const seekBy = useCallback((delta) => {
    const a = audioRef.current;
    if (a && Number.isFinite(a.currentTime)) seek(a.currentTime + delta);
  }, [seek]);

  const stop = useCallback(() => {
    playGeneration.current += 1;
    retryPending.current = false;
    lastPosition.current = { trackId: null, time: 0 };
    clearTts();
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute('src');
    }
    trackRef.current = null;
    requestedTrack.current = null;
    patch({ status: 'idle', currentTime: 0, duration: 0, title: '', trackId: null });
  }, [clearTts, patch]);

  // Mở khóa phát trong cử chỉ người dùng (chính sách autoplay của trình duyệt).
  const unlock = useCallback(() => {
    const a = audioRef.current;
    if (a && !trackRef.current) {
      a.muted = true;
      a.play()
        .then(() => {
          // A track may have been selected while play() was resolving. Do not
          // pause it or reset its position in that case.
          if (!trackRef.current) {
            a.pause();
            a.currentTime = 0;
          }
          a.muted = false;
        })
        .catch(() => {
          a.muted = false;
        });
    }
    if (ttsSupported) {
      // "Khởi động" speechSynthesis bằng utterance rỗng trong cử chỉ.
      try {
        window.speechSynthesis.resume();
      } catch {
        /* no-op */
      }
    }
  }, [ttsSupported]);

  useEffect(() => () => {
    clearTts();
    const a=audioRef.current;
    playGeneration.current += 1;
    if(a){a.onerror=null;a.onloadedmetadata=null;a.pause();a.removeAttribute('src');}
  }, [clearTts]);

  return useMemo(
    () => ({ state, playTrack, retry, toggle, pause, resume, seek, seekBy, stop, unlock, ttsSupported }),
    [state, playTrack, retry, toggle, pause, resume, seek, seekBy, stop, unlock, ttsSupported],
  );
}

// Ước lượng thời lượng TTS (giây) để vẽ thanh tiến độ — ~15 ký tự/giây.
function estimateTtsDuration(text) {
  return Math.max(2, Math.round((text?.length || 0) / 15));
}

