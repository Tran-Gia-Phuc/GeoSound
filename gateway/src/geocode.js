// =========================================================
// Proxy tìm địa chỉ (UC10 bước 3 — tác giả gõ địa chỉ để đặt điểm dừng).
//   GET /api/geocode?q=<địa chỉ>  →  { results: [{ name, displayName, lat, lng }] }
// Gọi Nominatim (OpenStreetMap) từ SERVER theo đúng điều khoản sử dụng:
//   - User-Agent định danh ứng dụng (GEOCODER_USER_AGENT)
//   - tối đa 1 request/giây (xếp hàng tuần tự)
//   - cache kết quả (24 giờ) để không hỏi lại cùng một địa chỉ
// =========================================================

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;
const MIN_GAP_MS = 1000;

/**
 * @param {{ fetchImpl?: typeof fetch, userAgent?: string, now?: () => number,
 *           sleep?: (ms: number) => Promise<void> }} [opts]
 */
export function createGeocoder({
  fetchImpl = globalThis.fetch,
  userAgent = 'GeoSound/0.1 (audio guide; https://github.com/Tran-Gia-Phuc/GeoSound)',
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const cache = new Map(); // khoá → { at, results }
  let queue = Promise.resolve();
  let lastAt = -Infinity; // lần đầu không phải chờ

  // Xếp hàng: mỗi lần gọi Nominatim cách nhau ≥ 1 giây.
  const throttled = (fn) => {
    const run = queue.then(async () => {
      const wait = lastAt + MIN_GAP_MS - now();
      if (wait > 0) await sleep(wait);
      lastAt = now();
      return fn();
    });
    queue = run.catch(() => {});
    return run;
  };

  async function search(q) {
    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.results;

    const url = `${NOMINATIM}?format=jsonv2&limit=5&accept-language=vi&q=${encodeURIComponent(q)}`;
    const rows = await throttled(async () => {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      return res.json();
    });

    const results = (Array.isArray(rows) ? rows : []).map((r) => ({
      name: r.name || String(r.display_name || '').split(',')[0],
      displayName: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
    }));
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, { at: now(), results });
    return results;
  }

  /** Express handler. */
  async function handler(req, res) {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.json({ results: [] });
    if (q.length > 200) return res.status(400).json({ error: 'Địa chỉ quá dài', code: 'bad_request' });
    try {
      res.json({ results: await search(q) });
    } catch (e) {
      console.warn('[gateway] geocode:', e.message);
      res.status(503).json({ error: 'Không tìm được địa chỉ lúc này, vui lòng thử lại', code: 'geocode_unavailable' });
    }
  }

  return { search, handler };
}
