// =========================================================
// Trạng thái bản dịch (UC12 → UC02/UC04). Quy tắc: khách chỉ được chọn một
// ngôn ngữ phụ khi MỌI điểm đã có bản dịch THẬT sang ngôn ngữ đó — tránh chuyện
// chọn "English" mà vẫn nghe tiếng Việt (bản dịch rỗng / y nguyên văn bản gốc do
// dịch vụ dịch chưa cấu hình).
// Thuần domain.
// =========================================================

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Bản dịch có nội dung và khác văn bản gốc (hoặc tác giả đã chỉnh tay). */
export function isRealTranslation(place, tx) {
  if (!tx || !norm(tx.text)) return false;
  if (tx.textSource === 'edited') return true;
  return norm(tx.text) !== norm(place.description);
}

/**
 * Chia ngôn ngữ đã cấu hình thành sẵn sàng / đang chờ dịch.
 * @param {{ source: string, languages: string[], places: Array<{id, description}>,
 *           translations: Array<{placeId, languageCode, text, textSource}> }} input
 * @returns {{ ready: string[], pending: string[],
 *             progress: Record<string, { translated: number, total: number }> }}
 *   ready luôn gồm ngôn ngữ gốc.
 */
export function splitLanguagesByReadiness({ source, languages, places, translations }) {
  const tx = new Map(translations.map((t) => [`${t.placeId}:${t.languageCode}`, t]));
  const ready = [];
  const pending = [];
  const progress = {};
  for (const code of languages) {
    if (code === source) {
      ready.push(code);
      progress[code] = { translated: places.length, total: places.length };
      continue;
    }
    const translated = places.filter((p) => isRealTranslation(p, tx.get(`${p.id}:${code}`))).length;
    progress[code] = { translated, total: places.length };
    (translated === places.length ? ready : pending).push(code);
  }
  return { ready, pending, progress };
}
