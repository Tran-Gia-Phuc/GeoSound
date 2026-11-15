// =========================================================
// UC21 — email to the account owner for event account.moderated (an admin warned, suspended,
// banned or restored the account). Sent to payload.email (no SECURITY_ALERT_TO override here).
// The reason is free text from the admin => escaped in HTML. Times in Vietnam time.
// =========================================================
import { formatVietnamTime } from './security-email-template.js';

export const ACCOUNT_MODERATED = 'account.moderated';

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Subject (also the in-app title) and intro sentence per action; null for an unknown action. */
export function accountActionCopy(payload = {}) {
  const until = formatVietnamTime(payload.until);
  switch (payload.action) {
    case 'warn':
      return {
        subject: 'Tài khoản GeoSound của bạn nhận một cảnh báo',
        intro: 'Quản trị viên đã gửi cảnh báo tới tài khoản của bạn vì nội dung hoặc hành vi vi phạm quy định.',
        advice: 'Vui lòng xem lại quy định cộng đồng. Tài khoản của bạn vẫn hoạt động bình thường.',
      };
    case 'suspend':
      return {
        subject: `Tài khoản GeoSound của bạn bị tạm khoá đến ${until}`,
        intro: `Quản trị viên đã tạm khoá tài khoản của bạn đến ${until}. Trong thời gian này bạn không thể đăng nhập.`,
        advice: 'Sau thời hạn trên bạn có thể đăng nhập lại. Nếu cho rằng đây là nhầm lẫn, hãy liên hệ quản trị viên.',
      };
    case 'ban':
      return {
        subject: 'Tài khoản GeoSound của bạn đã bị cấm',
        intro: 'Quản trị viên đã cấm vĩnh viễn tài khoản của bạn. Bạn không thể đăng nhập nữa.',
        advice: 'Nếu cho rằng đây là nhầm lẫn, hãy liên hệ quản trị viên.',
      };
    case 'restore':
      return {
        subject: 'Tài khoản GeoSound của bạn đã được khôi phục',
        intro: 'Quản trị viên đã gỡ khoá tài khoản của bạn. Bạn có thể đăng nhập lại bình thường.',
        advice: 'Cảm ơn bạn đã tuân thủ quy định cộng đồng GeoSound.',
      };
    default:
      return null;
  }
}

/**
 * @param {{ action: string, reason?: string, until?: string, fullName?: string, at?: string }} payload
 * @returns {null | { subject: string, text: string, html: string }} null for an unknown action
 */
export function buildAccountActionEmail(payload = {}) {
  const copy = accountActionCopy(payload);
  if (!copy) return null;
  const name = text(payload.fullName);
  const greeting = name ? `Xin chào ${name.slice(0, 200)},` : 'Xin chào,';
  const reason = text(payload.reason);
  const time = formatVietnamTime(payload.at);
  const footer = 'Đây là email tự động từ GeoSound, vui lòng không trả lời.';

  const lines = ['GeoSound', '', copy.subject, '', greeting, '', copy.intro, ''];
  if (reason) lines.push(`Lý do: ${reason}`);
  lines.push(`Thời gian xử lý: ${time}`, '', copy.advice, '', footer);

  const row = (label, value) =>
    `<tr><td style="padding:6px 0;font-size:14px;color:#64748b;width:130px;vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:15px;color:#0f172a;">${esc(value)}</td></tr>`;

  const html = `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(copy.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
        <tr><td style="padding:24px 32px;background-color:#0f172a;border-radius:16px 16px 0 0;">
          <p style="margin:0;color:#67e8f9;font-size:24px;font-weight:bold;">GeoSound</p>
          <p style="margin:8px 0 0;color:#cbd5e1;font-size:13px;">Khám phá hành trình qua âm thanh</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.4;">${esc(copy.subject)}</h1>
          <p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#475569;">${esc(greeting)}</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#475569;">${esc(copy.intro)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            ${reason ? row('Lý do', reason) : ''}
            ${row('Thời gian xử lý', time)}
          </table>
          <p style="margin:0;padding:16px;font-size:15px;line-height:1.6;color:#0f172a;background-color:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">${esc(copy.advice)}</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject: copy.subject, text: lines.join('\n'), html };
}
