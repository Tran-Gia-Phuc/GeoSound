// AI stub for the moderation end-to-end test (task #AI-40, issue #181).
// Implements the real Moderation -> AI HTTP contract (snake_case, header x-internal-token) without any LLM:
//   POST /moderate/place, POST /moderate/tour, GET /health.
// Deterministic markers in any text field:
//   E2E_REJECT -> Reject, severity 0.9, category scam
//   E2E_WARN   -> Warning, severity 0.5, category misleading
//   E2E_422    -> HTTP 422 (permanent input error)
//   otherwise  -> Pass, severity 0, no reasons
// No dependencies (node:http only). Never logs the token or request bodies.
import http from 'node:http';

const PORT = Number.parseInt(process.env.PORT ?? '3004', 10);
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? '';
const MODEL = 'e2e-stub';
const MAX_BODY = 1024 * 1024;

const MESSAGES = {
  en: { reject: 'Looks like a scam (e2e stub).', warn: 'May be misleading (e2e stub).' },
  vi: { reject: 'Có dấu hiệu lừa đảo (e2e stub).', warn: 'Có thể gây hiểu lầm (e2e stub).' },
};

// Counts calls per subject id, so the e2e script can check idempotency (GET /stats).
const calls = new Map();

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Returns [field, marker] for the first text field that carries a marker.
function findMarker(fields) {
  for (const marker of ['E2E_422', 'E2E_REJECT', 'E2E_WARN']) {
    for (const [field, text] of fields) {
      if (typeof text === 'string' && text.includes(marker)) return [field, marker];
    }
  }
  return null;
}

function judge(fields, language) {
  const found = findMarker(fields);
  const msg = MESSAGES[language] ?? MESSAGES.en;
  if (!found) return { verdict: 'Pass', severity: 0, reasons: [] };
  const [field, marker] = found;
  if (marker === 'E2E_422') return null;
  if (marker === 'E2E_REJECT') {
    return { verdict: 'Reject', severity: 0.9, reasons: [{ field, category: 'scam', message: msg.reject }] };
  }
  return { verdict: 'Warning', severity: 0.5, reasons: [{ field, category: 'misleading', message: msg.warn }] };
}

const isText = (v) => typeof v === 'string' && v.length > 0;

function moderatePlace(body) {
  if (!isText(body.place_id) || !isText(body.name) || !isText(body.description) || !isText(body.language)) {
    return [422, { detail: 'invalid input' }];
  }
  const images = Array.isArray(body.images) ? body.images : [];
  const fields = [['name', body.name], ['description', body.description]];
  images.forEach((img, i) => fields.push([`images[${i}]`, img?.caption]));
  const result = judge(fields, body.language);
  if (!result) return [422, { detail: 'E2E_422 marker' }];
  return [200, { place_id: body.place_id, ...result, images_checked: images.length, model: MODEL }];
}

function moderateTour(body) {
  if (!isText(body.tour_id) || !isText(body.title) || !isText(body.language) || !Array.isArray(body.places)) {
    return [422, { detail: 'invalid input' }];
  }
  const fields = [['title', body.title], ['description', body.description]];
  body.places.forEach((p) => fields.push(['coherence', p?.name], ['coherence', p?.description]));
  const result = judge(fields, body.language);
  if (!result) return [422, { detail: 'E2E_422 marker' }];
  return [200, { tour_id: body.tour_id, ...result, model: MODEL }];
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://stub');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok', service: 'ai-stub' });
  if (req.method === 'GET' && url.pathname === '/stats') {
    const id = url.searchParams.get('id');
    return send(res, 200, { id, calls: calls.get(id) ?? 0 });
  }
  const routes = { '/moderate/place': moderatePlace, '/moderate/tour': moderateTour };
  const handler = routes[url.pathname];
  if (req.method !== 'POST' || !handler) return send(res, 404, { detail: 'Not found' });
  if (!TOKEN || req.headers['x-internal-token'] !== TOKEN) return send(res, 401, { detail: 'invalid internal token' });
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 422, { detail: 'invalid JSON' });
  }
  if (!body || typeof body !== 'object') return send(res, 422, { detail: 'invalid input' });
  const id = body.place_id ?? body.tour_id;
  if (typeof id === 'string') calls.set(id, (calls.get(id) ?? 0) + 1);
  const [status, out] = handler(body);
  console.log(`[ai-stub] ${url.pathname} id=${id} -> ${status}${out.verdict ? ` ${out.verdict}` : ''}`);
  return send(res, status, out);
});

server.listen(PORT, () => console.log(`[ai-stub] listening on :${PORT}`));
