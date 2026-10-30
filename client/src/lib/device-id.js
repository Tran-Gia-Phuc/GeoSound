// =========================================================
// Device id (UC23): a random id created once per browser and kept in
// localStorage. Sent as `deviceId` on login and refresh so Auth keeps one
// session per device. Storage failures (private mode) fall back to an
// in-memory id so sign-in still works.
// =========================================================
const KEY = 'geosound.deviceId';

let memoryId = null;

function randomId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* randomUUID needs a secure context: fall through */
  }
  // Fallback: RFC 4122 v4 shape built from getRandomValues or Math.random.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Returns the id of this browser, creating and storing it on first use. */
export function getDeviceId() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
  } catch {
    /* storage blocked: use the in-memory id */
  }
  if (!memoryId) memoryId = randomId();
  try {
    localStorage.setItem(KEY, memoryId);
  } catch {
    /* keep the in-memory id for this page load */
  }
  return memoryId;
}
