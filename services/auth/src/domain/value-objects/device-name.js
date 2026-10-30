// =========================================================
// UC23 / R2 — readable device name from a User-Agent, e.g. "Chrome trên Windows",
// "Safari trên iPhone". Small dependency-free parser: browser + OS only.
// =========================================================

export const UNKNOWN_DEVICE = 'Thiết bị không xác định';

// Order matters: Edge and Opera also contain "Chrome", Chrome contains "Safari".
const BROWSERS = [
  [/EdgA?\/|Edge\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/CocCoc|coc_coc_browser/, 'Cốc Cốc'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

// Order matters: iPhone/iPad UAs say "like Mac OS X", Android UAs say "Linux".
const SYSTEMS = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

const pick = (list, ua) => list.find(([re]) => re.test(ua))?.[1] ?? null;

/** @param {string|null|undefined} userAgent @returns {string} */
export function deviceNameFromUserAgent(userAgent) {
  const ua = String(userAgent ?? '').slice(0, 512);
  if (!ua.trim()) return UNKNOWN_DEVICE;
  const browser = pick(BROWSERS, ua);
  const os = pick(SYSTEMS, ua);
  if (browser && os) return `${browser} trên ${os}`;
  return browser ?? os ?? UNKNOWN_DEVICE;
}
