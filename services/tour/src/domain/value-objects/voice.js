// =========================================================
// Nhãn giọng đọc (UC02). Quy tắc nghiệp vụ: ƯU TIÊN audio người thật;
// không có audio người thật (đúng ngôn ngữ đang chọn) → "giọng máy (TTS)".
// Thuần domain. Hiện chỉ có audio ngôn ngữ gốc (đa ngôn ngữ ở UC12), nên
// giọng người thật chỉ áp dụng khi ngôn ngữ chọn == ngôn ngữ gốc.
// =========================================================

export const VOICE_LABEL = Object.freeze({ HUMAN: 'human', TTS: 'tts' });

/** Nhãn giọng cho ngôn ngữ gốc của tour (danh sách kết quả — bước 5). */
export function voiceLabelFor({ hasHumanAudio }) {
  return hasHumanAudio ? VOICE_LABEL.HUMAN : VOICE_LABEL.TTS;
}

/**
 * Nhãn giọng theo ngôn ngữ khách chọn (chi tiết — bước 8–9 / A2).
 * @param {{ selectedLanguage: string, originalLanguage: string, hasHumanAudioOriginal: boolean }} p
 */
export function resolveVoiceLabel({ selectedLanguage, originalLanguage, hasHumanAudioOriginal }) {
  const isOriginal = selectedLanguage === originalLanguage;
  return isOriginal && hasHumanAudioOriginal ? VOICE_LABEL.HUMAN : VOICE_LABEL.TTS;
}
