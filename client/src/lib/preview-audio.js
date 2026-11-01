// Nghe thử nhanh một đoạn (ngoài trình phát tour): audio người thật nếu có URL
// http(s) hoặc cùng origin (/api/...), không thì đọc văn bản bằng giọng máy của trình duyệt (Web Speech).
// Trả hàm dừng. Chỉ một đoạn phát tại một thời điểm.
import { makeUtterance } from './speech.js';

let current = null;

export function stopPreview() {
  current?.();
  current = null;
}

/** @param {{ url?: string|null, text?: string, lang?: string, onEnd?: () => void }} p */
export function playPreview({ url, text, lang, onEnd }) {
  stopPreview();
  if (url && /^(https?:|\/)/i.test(url)) {
    const a = new Audio(url);
    a.onended = () => onEnd?.();
    a.play().catch(() => speak(text, lang, onEnd));
    current = () => a.pause();
    return stopPreview;
  }
  speak(text, lang, onEnd);
  return stopPreview;
}

function speak(text, lang, onEnd) {
  if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  // #263: full language tag + matching voice (Android stays silent with a bare 'vi' and no voice).
  const u = makeUtterance(text, lang);
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  const busy = synth.speaking || synth.pending;
  synth.cancel();
  // Chrome bỏ qua speak() gọi ngay sau cancel() — hoãn một nhịp, chỉ khi vừa hủy một đoạn đang đọc.
  // Otherwise speak at once, still inside the tap (mobile browsers need the user gesture).
  if (busy) setTimeout(() => synth.speak(u), 120);
  else synth.speak(u);
  current = () => synth.cancel();
}
