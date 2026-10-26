// Nghe thử nhanh một đoạn (ngoài trình phát tour): audio người thật nếu có URL
// http(s), không thì đọc văn bản bằng giọng máy của trình duyệt (Web Speech).
// Trả hàm dừng. Chỉ một đoạn phát tại một thời điểm.
let current = null;

export function stopPreview() {
  current?.();
  current = null;
}

/** @param {{ url?: string|null, text?: string, lang?: string, onEnd?: () => void }} p */
export function playPreview({ url, text, lang, onEnd }) {
  stopPreview();
  if (url && /^https?:/i.test(url)) {
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
  const u = new SpeechSynthesisUtterance(text);
  if (lang) u.lang = lang;
  u.onend = () => onEnd?.();
  window.speechSynthesis.cancel();
  // Chrome bỏ qua speak() gọi ngay sau cancel() — hoãn một nhịp.
  setTimeout(() => window.speechSynthesis.speak(u), 120);
  current = () => window.speechSynthesis.cancel();
}
