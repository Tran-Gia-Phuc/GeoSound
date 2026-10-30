// =========================================================
// Dựng nội dung email cho contributor theo từng event tour (UC16).
// Keyed theo routing-key (vd 'tour.approved') để không phụ thuộc shared/events
// -> template unit-test được độc lập.
// reason/tourTitle là free text => PHẢI escape HTML để chặn injection.
// =========================================================

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// spec.reason = true => hiển thị lý do (nếu payload có reason).
const specs = {
  'tour.approved': {
    subject: 'Tour của bạn đã được duyệt',
    heading: 'Tour đã được duyệt',
    body: (title) => `Chúc mừng! Tour ${title} đã được duyệt và sẽ sớm hiển thị công khai trên GeoSound.`,
  },
  'tour.rejected': {
    subject: 'Tour của bạn chưa được duyệt',
    heading: 'Tour bị từ chối',
    body: (title) => `Rất tiếc, tour ${title} chưa được duyệt.`,
    reason: true,
  },
  // UC19 / A3 — admin asked for changes; the author edits and submits again.
  'tour.changes_requested': {
    subject: 'Tour cần chỉnh sửa',
    heading: 'Tour cần chỉnh sửa',
    body: (title) => `Quản trị viên yêu cầu chỉnh sửa tour ${title}. Vui lòng cập nhật theo góp ý bên dưới và gửi duyệt lại.`,
    reason: true,
  },
  'tour.ai_rejected': {
    subject: 'Tour không qua kiểm duyệt tự động',
    heading: 'Kiểm duyệt nội dung tự động',
    body: (title) => `Tour ${title} không vượt qua bước kiểm duyệt nội dung tự động.`,
    reason: true,
  },
  'tour.hidden': {
    subject: 'Tour của bạn đã bị ẩn',
    heading: 'Tour đã bị ẩn',
    body: (title) => `Tour ${title} đã bị ẩn khỏi GeoSound.`,
    reason: true,
  },
  'tts.render.completed': {
    subject: 'Âm thanh thuyết minh đã sẵn sàng',
    heading: 'Thuyết minh đã sẵn sàng',
    body: (title) => `Phần âm thanh thuyết minh cho tour ${title} đã được tạo xong và sẵn sàng sử dụng.`,
  },
};

/**
 * @returns {{subject,text,html}|null} null nếu event không có email gửi contributor
 * (vd 'tour.reported' là tín hiệu nội bộ cho admin).
 */
export function buildTourEmail({ event, payload = {} }) {
  const spec = specs[event];
  if (!spec) return null;

  const rawTitle = payload.tourTitle ? payload.tourTitle : '';
  const title = rawTitle ? `“${esc(rawTitle)}”` : 'của bạn';
  const bodyText = spec.body(rawTitle ? `“${rawTitle}”` : 'của bạn');
  const bodyHtml = spec.body(title);
  const reason = spec.reason && payload.reason ? String(payload.reason) : '';
  const footer = 'Đây là email tự động từ GeoSound, vui lòng không trả lời.';

  const text = [
    'GeoSound',
    '',
    spec.heading,
    '',
    bodyText,
    ...(reason ? ['', `Lý do: ${reason}`] : []),
    '',
    footer,
  ].join('\n');

  const reasonHtml = reason
    ? `<p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#475569;">LÝ DO</p>
          <p style="margin:0 0 24px;padding:16px;font-size:15px;line-height:1.6;color:#0f172a;background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;">${esc(reason)}</p>`
    : '';

  const html = `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(spec.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
        <tr><td style="padding:24px 32px;background-color:#0f172a;border-radius:16px 16px 0 0;">
          <p style="margin:0;color:#67e8f9;font-size:24px;font-weight:bold;">GeoSound</p>
          <p style="margin:8px 0 0;color:#cbd5e1;font-size:13px;">Khám phá hành trình qua âm thanh</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.4;">${esc(spec.heading)}</h1>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569;">${bodyHtml}</p>
          ${reasonHtml}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject: spec.subject, text, html };
}
