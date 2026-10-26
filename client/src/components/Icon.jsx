// Bộ icon SVG inline (phong cách Lucide) — KHÔNG dùng emoji.
// Dùng currentColor; mặc định có aria-hidden (icon trang trí).
const P = {
  play: <path d="M6 4l14 8-14 8V4z" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>
  ),
  'skip-back': (
    <>
      <path d="M19 5v14l-11-7 11-7z" />
      <rect x="4" y="5" width="2.5" height="14" rx="1" />
    </>
  ),
  'skip-forward': (
    <>
      <path d="M5 5l11 7-11 7V5z" />
      <rect x="17.5" y="5" width="2.5" height="14" rx="1" />
    </>
  ),
  rewind: <path d="M11 12l9-7v14l-9-7zM2 12l9-7v14l-9-7z" />,
  forward: <path d="M13 12L4 5v14l9-7zM22 12l-9-7v14l9-7z" />,
  'map-pin': (
    <>
      <path d="M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  navigation: <path d="M3 11l19-9-9 19-2-8-8-2z" />,
  headphones: (
    <>
      <path d="M4 14v-2a8 8 0 0116 0v2" />
      <rect x="2.5" y="13" width="4.5" height="7" rx="2" />
      <rect x="17" y="13" width="4.5" height="7" rx="2" />
    </>
  ),
  languages: (
    <>
      <path d="M4 5h9M8 3v2c0 4-2 7-5 9" />
      <path d="M6 10c1.5 3 4 5 7 6" />
      <path d="M13 21l4-10 4 10M14.5 17h5" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'arrow-left': <path d="M19 12H5M12 19l-7-7 7-7" />,
  'alert-triangle': (
    <>
      <path d="M12 3l9.5 17H2.5L12 3z" />
      <path d="M12 10v4M12 17.5v.5" />
    </>
  ),
  loader: <path d="M12 3v4M12 17v4M5 12H1m22 0h-4M6 6l2.5 2.5M18 18l-2.5-2.5M6 18l2.5-2.5M18 6l-2.5 2.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  crosshair: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  star: <path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18l-5.9 3 1.2-6.5L2.5 9.9 9.1 9 12 3z" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.8" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4 12H2m20 0h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
    </>
  ),
  moon: <path d="M21 12.8A8.5 8.5 0 1111.2 3 6.5 6.5 0 0021 12.8z" />,
  'wifi-off': <path d="M2 4l20 20M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 015-2.6M1.5 9A15 15 0 018 6.3M16 10a10 10 0 013.5 2.2M22.5 9a15 15 0 00-6-3.6M12 20h.01" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.6l6.8-4.2M8.6 13.4l6.8 4.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h10" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />,
  route: (
    <>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19H15a3.5 3.5 0 000-7H9a3.5 3.5 0 010-7h6.5" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 9a3 3 0 010 6M18.5 7a6 6 0 010 10" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h10M18 18h2" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </>
  ),
  download: <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />,
  map: <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zM9 3v15M15 6v15" />,
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.8 10.8 0 0112 5c6.4 0 10 7 10 7a17.6 17.6 0 01-3.2 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 005.4-1.6" />
      <path d="M9.9 9.9a3 3 0 004.2 4.2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
};

// Icon tô đặc (hình khối) thay vì nét.
const FILLED = new Set(['play', 'pause', 'skip-back', 'skip-forward', 'rewind', 'forward', 'navigation', 'star']);

export default function Icon({ name, size = 22, strokeWidth = 2, className, title }) {
  const path = P[name];
  if (!path) return null;
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {path}
    </svg>
  );
}
