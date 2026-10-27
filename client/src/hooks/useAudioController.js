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

const isPlayableUrl = (src) => typeof src === 'string' && /^(https?:|blob:|data:|\/)/.test(src);

export function useAudioController({ onEnded } = {}) {
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const audioRef = useRef(null);
  const trackRef = useRef(null); // track đang phát (để biết nguồn khi 'ended')
  const endedRef = useRef(onEnded);
  const ttsKeepAlive = useRef(null);
  const ttsStart = useRef(0);
  const activeUtter = useRef(null); // phân biệt callback cũ sau khi cancel()

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
  });

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
    const onTime = () => patch({ currentTime: a.currentTime });
    const onMeta = () =>
      patch({ duration: Number.isFinite(a.duration) ? a.duration : 0, canSeek: true });
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
  const speak = useCallback(
    (text, lang, { fellBack = false, title = '', trackId = null } = {}) => {
      clearTts();
      if (audioRef.current) audioRef.current.pause();
      if (!ttsSupported || !text) {
        patch({ status: 'error', usingTts: true, fellBack, title, trackId });
        return false;
      }
      const u = new SpeechSynthesisUtterance(text);
      if (lang) u.lang = lang.length === 2 ? mapLang(lang) : lang;
      u.rate = 1;
      activeUtter.current = u;
      u.onend = () => {
        if (activeUtter.current !== u) return; // callback của lần phát đã bị thay
        if (ttsKeepAlive.current) clearInterval(ttsKeepAlive.current);
        handleEnded();
      };
      u.onerror = () => {
        if (activeUtter.current !== u) return; // bỏ qua lỗi do cancel()
        if (ttsKeepAlive.current) clearInterval(ttsKeepAlive.current);
        patch({ status: 'error' });
      };
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
      });
      window.speechSynthesis.speak(u);
      // Né lỗi Chrome dừng giữa chừng với văn bản dài + cập nhật tiến độ ước lượng.
      ttsKeepAlive.current = setInterval(() => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
          patch({ currentTime: (Date.now() - ttsStart.current) / 1000 });
        }
      }, 1000);
      return true;
    },
    [clearTts, ttsSupported, patch, handleEnded],
  );

  /**
   * Phát một track.
   * @param {{ kind?:'url'|'tts', src?:string, text?:string, lang?:string,
   *           title?:string, id?:string }} track
   */
  const playTrack = useCallback(
    (track) => {
      if (!track) return;
      const title = track.title || '';
      const trackId = track.id ?? null;
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
        // A prior unlock may still be pending. A selected track must never stay muted.
        a.muted = false;
        a.src = track.src;
        a.play().catch(() => {
          // Autoplay bị chặn hoặc file hỏng -> TTS fallback nếu có text.
          if (track.text) speak(track.text, track.lang, { fellBack: true, title, trackId });
          else patch({ status: 'error', title, trackId });
        });
        // Lỗi tải nguồn (404/hỏng) -> fallback.
        a.onerror = () => {
          if (track.text) speak(track.text, track.lang, { fellBack: true, title, trackId });
          else patch({ status: 'error', title, trackId });
        };
        return;
      }
      // Không có URL phát được (null hoặc 'tts://...') -> đọc text.
      speak(track.text, track.lang, { fellBack: false, title, trackId });
    },
    [clearTts, patch, speak],
  );

  const pause = useCallback(() => {
    if (trackRef.current?.kind === 'tts') {
      if (ttsSupported) window.speechSynthesis.pause();
      patch({ status: 'paused' });
    } else {
      audioRef.current?.pause();
    }
  }, [patch, ttsSupported]);

  const resume = useCallback(() => {
    if (trackRef.current?.kind === 'tts') {
      if (ttsSupported) window.speechSynthesis.resume();
      patch({ status: 'playing' });
    } else {
      audioRef.current?.play().catch(() => {});
    }
  }, [patch, ttsSupported]);

  const toggle = useCallback(() => {
    setState((s) => {
      if (s.status === 'playing') pause();
      else if (s.status === 'paused') resume();
      return s;
    });
  }, [pause, resume]);

  const seek = useCallback((sec) => {
    const a = audioRef.current;
    if (trackRef.current?.kind === 'url' && a && Number.isFinite(a.duration)) {
      a.currentTime = Math.max(0, Math.min(sec, a.duration));
    }
  }, []);

  const stop = useCallback(() => {
    clearTts();
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute('src');
    }
    trackRef.current = null;
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

  useEffect(() => () => clearTts(), [clearTts]);

  return useMemo(
    () => ({ state, playTrack, toggle, pause, resume, seek, stop, unlock, ttsSupported }),
    [state, playTrack, toggle, pause, resume, seek, stop, unlock, ttsSupported],
  );
}

// Ước lượng thời lượng TTS (giây) để vẽ thanh tiến độ — ~15 ký tự/giây.
function estimateTtsDuration(text) {
  return Math.max(2, Math.round((text?.length || 0) / 15));
}

// Mã 2 ký tự -> BCP-47 để giọng đọc chuẩn hơn.
function mapLang(code) {
  const m = { vi: 'vi-VN', en: 'en-US', fr: 'fr-FR', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', es: 'es-ES', de: 'de-DE', th: 'th-TH', ru: 'ru-RU' };
  return m[code] || code;
}
