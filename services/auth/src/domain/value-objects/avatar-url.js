// =========================================================
// UC18 — avatar URL rule (docs/02-design/uc18-author-page.md R6). The image itself is uploaded
// through Media by the client; Auth only stores the URL. Accepted:
//   - any https URL;
//   - a Media file URL `http(s)://<host>/api/media/files/images/...` (the local gateway is http);
//   - the Media path form `/api/media/files/images/...`.
// Anything else (javascript:, data:, other http paths, protocol-relative, spaces) is refused.
// Pure domain: no framework.
// =========================================================

export const AVATAR_URL_MAX = 500;
export const MEDIA_IMAGE_PATH = '/api/media/files/images/';

// No whitespace, control characters or backslashes anywhere (they hide tricks in URLs).
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\s\u0000-\u001f\u007f\\]/;

function isMediaImagePath(pathname) {
  if (!pathname.startsWith(MEDIA_IMAGE_PATH) || pathname.length === MEDIA_IMAGE_PATH.length) return false;
  // No parent segments, raw or percent-encoded.
  return !pathname.split('/').some((seg) => seg === '..' || /^%2e%2e$/i.test(seg) || seg === '.');
}

/** @param {unknown} value @returns {boolean} */
export function isValidAvatarUrl(value) {
  if (typeof value !== 'string' || !value || value.length > AVATAR_URL_MAX) return false;
  if (UNSAFE.test(value)) return false;

  // Path form (same origin through the gateway). "//host/..." is protocol-relative: refused.
  if (value.startsWith('/')) {
    if (value.startsWith('//')) return false;
    let url;
    try {
      url = new URL(value, 'http://media.local');
    } catch {
      return false;
    }
    return url.host === 'media.local' && isMediaImagePath(url.pathname);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!url.hostname || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return isMediaImagePath(url.pathname);
  return false;
}
