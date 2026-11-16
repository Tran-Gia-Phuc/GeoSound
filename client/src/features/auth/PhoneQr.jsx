// =========================================================
// PhoneQr: QR code that opens GeoSound on a phone (sign-in page, wide screens only).
// The code is drawn in the browser from a URL (no image file, no network):
//   - VITE_PUBLIC_URL when set (the ngrok demo sets it, so a PC on localhost shows the ngrok URL),
//   - otherwise the current origin, except loopback hosts, which a phone cannot open.
// See docs/04-guides/phone-demo.md.
// =========================================================
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const QUIET = 4; // blank modules around the code, as the QR spec asks

/** URL the QR code opens, or null when there is none a phone can reach. */
export function phoneUrl(loc = window.location, configured = import.meta.env.VITE_PUBLIC_URL) {
  if (configured) return configured;
  const host = loc.hostname;
  if (LOOPBACK.has(host) || host.endsWith('.localhost')) return null;
  return loc.origin + '/';
}

/** One SVG path with a 1x1 square per dark module. */
function qrPath(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (qr.isDark(r, c)) d += `M${c + QUIET},${r + QUIET}h1v1h-1z`;
    }
  }
  return { d, view: size + QUIET * 2 };
}

export default function PhoneQr({ url }) {
  const { d, view } = useMemo(() => qrPath(url), [url]);
  return (
    <figure className="login-a-qr">
      <svg
        role="img"
        aria-label="Mã QR mở GeoSound trên điện thoại"
        data-url={url}
        viewBox={`0 0 ${view} ${view}`}
        width="120"
        height="120"
        shapeRendering="crispEdges"
      >
        <rect width={view} height={view} fill="#fff" />
        <path d={d} fill="#000" />
      </svg>
      <figcaption>
        Quét mã để mở GeoSound trên điện thoại.
        <span className="login-a-qr__url">{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
      </figcaption>
    </figure>
  );
}
