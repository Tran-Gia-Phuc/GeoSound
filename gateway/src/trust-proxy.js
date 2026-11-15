// TRUST_PROXY (deployment plan task 0.10, #361): when a reverse proxy (Caddy in
// docker-compose.prod.yml, the Ingress later) sits in front of the gateway, express must trust it,
// or req.ip is the proxy's address and the per-IP rate limits put every client in one bucket.
//   unset or empty -> undefined: express default (trust nobody), dev and the ngrok demo unchanged
//   "1", "2"...    -> number of proxy hops to trust
//   "true"/"false" -> boolean
//   anything else  -> passed as is (express accepts "loopback", subnets, comma lists)
export function parseTrustProxy(value) {
  const v = String(value ?? '').trim();
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}
