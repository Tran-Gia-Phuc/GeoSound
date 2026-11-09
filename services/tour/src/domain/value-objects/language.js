// =========================================================
// Value Object: Language (mã ngôn ngữ gốc của tour — UC09 bắt buộc).
// Chuẩn hóa (trim + lowercase) và kiểm tra thuộc tập hỗ trợ.
// Thuần domain — không phụ thuộc framework.
// =========================================================
import { ValidationError } from '../errors/index.js';

// Tập ngôn ngữ hỗ trợ (UC12) — same list as the AI service (translation LANGUAGE_NAMES) and the
// client (lib/speech.js LANG_TAGS, lib/format.js LANG_LABELS).
export const SUPPORTED_LANGUAGES = Object.freeze(['vi', 'en', 'fr', 'ja', 'ko', 'zh', 'es', 'de', 'th', 'ru']);

export class Language {
  /** @param {string} value */
  constructor(value) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    if (!normalized) throw new ValidationError('Vui lòng chọn ngôn ngữ gốc');
    if (!SUPPORTED_LANGUAGES.includes(normalized)) {
      throw new ValidationError(`Ngôn ngữ không hỗ trợ: ${normalized}`);
    }
    this.value = normalized;
  }

  toString() {
    return this.value;
  }
}
