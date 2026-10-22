// =========================================================
// TtsSynthesizer (DEV) — sinh URL TTS tất định từ (ngôn ngữ, giọng, text) bằng
// băm sha1, chưa render file thật. Giữ hợp đồng port để luồng UC12 chạy/test
// được. prerendered=false vì pre-render & cache offline diễn ra khi tải (UC03).
// SẢN XUẤT: thay bằng adapter gọi dịch vụ TTS (ví dụ Google Cloud TTS); lỗi → E1.
// =========================================================
import { createHash } from 'node:crypto';

/** @implements {import('../../domain/ports/index.js').TtsSynthesizer} */
export class PlaceholderTtsSynthesizer {
  /** @param {{ text: string, language: string, voice: { gender: string, region: string|null } }} p */
  async synthesize({ text, language, voice }) {
    const region = voice.region || 'std';
    const digest = createHash('sha1')
      .update(`${language}|${voice.gender}|${region}|${text}`)
      .digest('hex')
      .slice(0, 16);
    return { url: `tts://${language}/${voice.gender}-${region}/${digest}.mp3`, prerendered: false };
  }
}
