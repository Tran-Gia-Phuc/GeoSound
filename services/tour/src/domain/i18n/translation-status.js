// =========================================================
// Trạng thái bản dịch (UC12 → UC02/UC04). Quy tắc: khách chỉ được chọn một
// ngôn ngữ phụ khi MỌI điểm đã có bản dịch THẬT sang ngôn ngữ đó — tránh chuyện
// chọn "English" mà vẫn nghe tiếng Việt (bản dịch rỗng / y nguyên văn bản gốc do
// dịch vụ dịch chưa cấu hình).
// Freshness (UC10 edit): a machine translation is only real while its source_hash matches the
// current description. An edited one is always kept; when the source changed it is "outdated"
// (still served, flagged for the author). A null hash = row older than the column: fresh.
// Thuần domain.
// =========================================================
import { sourceHash } from './source-hash.js';

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** The translation was made from the current description (or is older than the hash column). */
export function isFreshTranslation(place, tx) {
  if (!tx) return false;
  if (tx.sourceHash == null) return true;
  return tx.sourceHash === sourceHash(place.description);
}

/** An author-edited translation whose source text changed since the edit. */
export function isOutdatedEdit(place, tx) {
  return tx?.textSource === 'edited' && !isFreshTranslation(place, tx);
}

/** Bản dịch có nội dung và khác văn bản gốc (hoặc tác giả đã chỉnh tay), và chưa cũ. */
export function isRealTranslation(place, tx) {
  if (!tx || !norm(tx.text)) return false;
  if (tx.textSource === 'edited') return true;
  if (!isFreshTranslation(place, tx)) return false;
  return norm(tx.text) !== norm(place.description);
}

/**
 * The translation must be (re)made: missing, empty, a copy of the source (EchoTranslator, no AI
 * key at the time), or a machine one whose hash does not match the current description. A null
 * hash counts as "must be made" here so a refresh backfills it. An edited one is never replaced.
 */
export function needsTranslation(place, tx) {
  if (!tx || !norm(tx.text)) return true;
  if (tx.textSource === 'edited') return false;
  if (norm(tx.text) === norm(place.description)) return true;
  return tx.sourceHash !== sourceHash(place.description);
}

/**
 * Chia ngôn ngữ đã cấu hình thành sẵn sàng / đang chờ dịch.
 * @param {{ source: string, languages: string[], places: Array<{id, description}>,
 *           translations: Array<{placeId, languageCode, text, textSource, sourceHash?}> }} input
 * @returns {{ ready: string[], pending: string[],
 *             progress: Record<string, { translated: number, total: number, outdated: number }> }}
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
      progress[code] = { translated: places.length, total: places.length, outdated: 0 };
      continue;
    }
    const translated = places.filter((p) => isRealTranslation(p, tx.get(`${p.id}:${code}`))).length;
    const outdated = places.filter((p) => isOutdatedEdit(p, tx.get(`${p.id}:${code}`))).length;
    progress[code] = { translated, total: places.length, outdated };
    (translated === places.length ? ready : pending).push(code);
  }
  return { ready, pending, progress };
}
