import nodemailer from 'nodemailer';

export function createSmtpMailer(env = process.env, createTransport = nodemailer.createTransport) {
  const port = Number(env.SMTP_PORT || 587);
  if (!env.SMTP_HOST || !env.SMTP_FROM || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Valid SMTP_HOST, SMTP_FROM and SMTP_PORT are required');
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) {
    throw new Error('SMTP_USER and SMTP_PASS must be configured together');
  }
  const transport = createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  return {
    async send({ to, ...content }) {
      const result = await transport.sendMail({ ...content, from: env.SMTP_FROM, to });
      if (!result.accepted?.length || result.rejected?.length) {
        const error = new Error('SMTP did not accept the recipient');
        error.code = 'SMTP_RECIPIENT_REJECTED';
        throw error;
      }
      return { status: 'smtp_accepted', messageId: result.messageId };
    },
    close() { transport.close(); },
  };
}
