// =========================================================
// UC23 / R10 — email "Đăng nhập mới trên <thiết bị>" for event auth.new_device_login.
// deviceName/location come from the User-Agent and the IP => free text, escaped in HTML.
// Time is shown in Vietnam time (UTC+7, no DST), formatted by hand so it does not depend on ICU.
// =========================================================

export const NEW_DEVICE_LOGIN = 'auth.new_device_login';
const UNKNOWN = 'Không xác định';

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** "14:05 30/10/2026 (giờ Việt Nam)"; "Không xác định" for a missing or bad date. */
export function formatVietnamTime(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return UNKNOWN;
  const d = new Date(t + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} (giờ Việt Nam)`;
}

/**
 * @param {{ deviceName?: string, location?: string, at?: string }} payload
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildNewDeviceEmail(payload = {}) {
  const device = String(payload.deviceName || 'thiết bị không xác định').slice(0, 200);
  const location = payload.location ? String(payload.location).slice(0, 200) : UNKNOWN;
  const time = formatVietnamTime(payload.at);
  const subject = `Đăng nhập mới trên ${device}`;
  const intro = 'Tài khoản GeoSound của bạn vừa được đăng nhập trên một thiết bị mới.';
  const advice =
    'Nếu đó là bạn, bạn không cần làm gì thêm. Nếu không phải bạn, hãy mở "Thiết bị đang đăng nhập" ' +
    'trong tài khoản để đăng xuất thiết bị này, rồi đổi mật khẩu.';
  const footer = 'Đây là email tự động từ GeoSound, vui lòng không trả lời.';

  const text = [
    'GeoSound',
    '',
    subject,
    '',
    intro,
    '',
    `Thiết bị: ${device}`,
    `Thời gian: ${time}`,
    `Vị trí: ${location}`,
    '',
    advice,
    '',
    footer,
  ].join('\n');

  const row = (label, value) =>
    `<tr><td style="padding:6px 0;font-size:14px;color:#64748b;width:110px;">${label}</td><td style="padding:6px 0;font-size:15px;color:#0f172a;font-weight:bold;">${esc(value)}</td></tr>`;

  const html = `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
        <tr><td style="padding:24px 32px;background-color:#0f172a;border-radius:16px 16px 0 0;">
          <p style="margin:0;color:#67e8f9;font-size:24px;font-weight:bold;">GeoSound</p>
          <p style="margin:8px 0 0;color:#cbd5e1;font-size:13px;">Khám phá hành trình qua âm thanh</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.4;">${esc(subject)}</h1>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#475569;">${esc(intro)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            ${row('Thiết bị', device)}
            ${row('Thời gian', time)}
            ${row('Vị trí', location)}
          </table>
          <p style="margin:0;padding:16px;font-size:15px;line-height:1.6;color:#0f172a;background-color:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">${esc(advice)}</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
