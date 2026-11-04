// =========================================================
// UC14 (#269) — PasscodeHasher with Node's built-in scrypt (no new dependency): random 16-byte salt,
// 32-byte key, stored as "scrypt$N$r$p$<salt b64>$<key b64>". verify() uses timingSafeEqual and
// returns false (never throws) for a malformed stored value.
// =========================================================
import crypto from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

function scrypt(plain, salt, { N, r, p }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(plain, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** @implements {import('../../domain/ports/index.js').PasscodeHasher} */
export class ScryptPasscodeHasher {
  /** @param {string} plain @returns {Promise<string>} */
  async hash(plain) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(String(plain), salt, PARAMS);
    return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  /** @param {string} plain @param {string|null} stored @returns {Promise<boolean>} */
  async verify(plain, stored) {
    if (typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [N, r, p] = parts.slice(1, 4).map(Number);
    if (![N, r, p].every(Number.isInteger)) return false;
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (expected.length !== KEYLEN) return false;
    const key = await scrypt(String(plain), salt, { N, r, p });
    return crypto.timingSafeEqual(key, expected);
  }
}
