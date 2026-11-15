// =========================================================
// Hash of the source text a translation was made from (UC12 / UC10). Stored with the
// translation (place_translations.source_hash): when the place description changes the hash
// no longer matches and the machine translation is stale.
// Whitespace is normalised so a re-indented description does not count as a change.
// Pure domain (node:crypto only).
// =========================================================
import { createHash } from 'node:crypto';

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** @param {string|null|undefined} text @returns {string} 16 hex characters */
export function sourceHash(text) {
  return createHash('sha1').update(norm(text)).digest('hex').slice(0, 16);
}
