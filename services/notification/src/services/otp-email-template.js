import { z } from 'zod';

const templateInput = z.object({
  code: z.string().regex(/^\d{6}$/),
  // ERD OTP_CODES uses reset_pw; accept Auth's existing reset spelling too.
  purpose: z.enum(['register', 'reset_pw', 'reset']).transform(value => value === 'reset' ? 'reset_pw' : value),
  ttlSeconds: z.number().int().positive().default(120),
});

const copy = {
  register: {
    subject: 'Mã OTP đăng ký GeoSound',
    heading: 'Xác thực tài khoản của bạn',
    description: 'Chào mừng bạn đến với GeoSound. Nhập mã bên dưới để hoàn tất đăng ký tài khoản.',
  },
  reset_pw: {
    subject: 'Mã OTP đặt lại mật khẩu GeoSound',
    heading: 'Đặt lại mật khẩu',
    description: 'Chúng tôi nhận được yêu cầu đặt lại mật khẩu tài khoản GeoSound của bạn. Nhập mã bên dưới để tiếp tục.',
  },
};

// Local rendering input only; the team's event/payload will be supplied later.
export function buildOtpEmail(input) {
  const { code, purpose, ttlSeconds } = templateInput.parse(input);
  const { subject, heading, description } = copy[purpose];
  const lifetime = ttlSeconds % 60 === 0 ? `${ttlSeconds / 60} phút` : `${ttlSeconds} giây`;
  const expiry = `Mã có hiệu lực trong ${lifetime}.`;
  const warning = 'Không chia sẻ mã này với bất kỳ ai, kể cả người tự xưng là nhân viên GeoSound.';
  const footer = 'Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email. Đây là email tự động, vui lòng không trả lời.';
  return {
    subject,
    text: `GeoSound\n\n${heading}\n\n${description}\n\nMã OTP: ${code}\n${expiry}\n\n${warning}\n\n${footer}`,
    html: `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
        <tr><td style="padding:24px 32px;background-color:#0f172a;border-radius:16px 16px 0 0;">
          <p style="margin:0;color:#67e8f9;font-size:24px;font-weight:bold;">GeoSound</p>
          <p style="margin:8px 0 0;color:#cbd5e1;font-size:13px;">Khám phá hành trình qua âm thanh</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.4;">${heading}</h1>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569;">${description}</p>
          <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#475569;">MÃ XÁC THỰC CỦA BẠN</p>
          <p style="margin:0;padding:20px 12px;text-align:center;font-family:Consolas,monospace;font-size:36px;letter-spacing:8px;font-weight:bold;background-color:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;">${code}</p>
          <p style="margin:12px 0 24px;font-size:14px;color:#475569;">${expiry}</p>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">${warning}</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
