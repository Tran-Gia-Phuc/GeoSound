// =========================================================
// Value Object: Language (mã ngôn ngữ gốc của tour — UC09 bắt buộc).
// Chuẩn hóa (trim + lowercase) và kiểm tra thuộc tập hỗ trợ.
// Thuần domain — không phụ thuộc framework.
// =========================================================
import { ValidationError } from '../errors/index.js';

// Default listening languages (UC12). Tour owns the list (#425): a deployment changes it with the
// SUPPORTED_LANGUAGES variable (container.js), and the client reads it from GET /api/tours/languages.
// The AI translation passes a code it does not know to the model as it is.
export const DEFAULT_LANGUAGES = Object.freeze(['vi', 'en', 'fr', 'ja', 'ko', 'zh', 'es', 'de', 'th', 'ru']);

// A language code, lower case: 2-3 letters, optional region or script ('zh-tw', 'pt-br', 'zh-hant').
// At most 10 characters, like the request schemas and the stored columns expect.
export const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/;

/**
 * Languages accepted now. A live binding: the container sets it once at start.
 * @type {readonly string[]}
 */
export let SUPPORTED_LANGUAGES = DEFAULT_LANGUAGES;

/**
 * Parses a comma separated list ("vi, en, id, zh-TW"): trimmed, lower-cased, duplicates dropped.
 * @param {string|undefined} raw
 * @returns {{ codes: string[], invalid: string[] }} codes is empty when nothing valid was given
 */
export function parseLanguageList(raw) {
  const codes = [];
  const invalid = [];
  for (const part of String(raw ?? '').split(',')) {
    const code = part.trim().toLowerCase();
    if (!code) continue;
    if (!LANGUAGE_CODE.test(code)) invalid.push(part.trim());
    else if (!codes.includes(code)) codes.push(code);
  }
  return { codes, invalid };
}

/**
 * Sets the supported list (called once by the container). An empty list keeps the default.
 * @param {readonly string[]} codes valid, lower-cased codes (parseLanguageList)
 * @returns {readonly string[]} the list in use
 */
export function configureSupportedLanguages(codes) {
  SUPPORTED_LANGUAGES = codes?.length ? Object.freeze([...codes]) : DEFAULT_LANGUAGES;
  return SUPPORTED_LANGUAGES;
}

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
