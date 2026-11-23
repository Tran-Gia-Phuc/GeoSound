// =========================================================
// UC25 (#446) — MoMo payment gateway, API v2 (sandbox https://test-payment.momo.vn).
//   create  POST /v2/gateway/api/create  -> payUrl (the buyer pays on the MoMo page)
//   query   POST /v2/gateway/api/query   -> resultCode of an order (the IPN cannot reach localhost)
//   IPN     body posted by MoMo to MOMO_IPN_URL, checked with verifyIpn()
// Signatures: HMAC SHA256 (secret key) of "key=value&..." in the order MoMo documents.
// fetch is injected (tests use a fake, never the network). The keys are never logged.
// =========================================================
import crypto from 'node:crypto';

export const MOMO_SANDBOX = 'https://test-payment.momo.vn';

export const signMomo = (raw, secretKey) => crypto.createHmac('sha256', secretKey).update(raw).digest('hex');

const IPN_FIELDS = ['amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];

export class MomoClient {
  /**
   * @param {{ partnerCode: string, accessKey: string, secretKey: string, endpoint?: string,
   *   redirectUrl: string, ipnUrl: string, fetch?: typeof fetch, timeoutMs?: number }} cfg
   */
  constructor({ partnerCode, accessKey, secretKey, endpoint = MOMO_SANDBOX, redirectUrl, ipnUrl, fetch: f = globalThis.fetch, timeoutMs = 15000 }) {
    Object.assign(this, { partnerCode, accessKey, secretKey, redirectUrl, ipnUrl, timeoutMs });
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.fetch = f;
  }

  /** null when a key is missing: purchases then answer 503 payment_unavailable. */
  static fromEnv(env, { fetch: f } = {}) {
    const { MOMO_PARTNER_CODE, MOMO_ACCESS_KEY, MOMO_SECRET_KEY } = env;
    if (!MOMO_PARTNER_CODE || !MOMO_ACCESS_KEY || !MOMO_SECRET_KEY) return null;
    const redirectUrl = env.PAYMENT_RETURN_URL || 'http://localhost:5173/payment/momo';
    return new MomoClient({
      partnerCode: MOMO_PARTNER_CODE,
      accessKey: MOMO_ACCESS_KEY,
      secretKey: MOMO_SECRET_KEY,
      endpoint: env.MOMO_ENDPOINT || MOMO_SANDBOX,
      redirectUrl,
      ipnUrl: env.MOMO_IPN_URL || `${new URL(redirectUrl).origin}/api/tours/payments/momo/ipn`,
      fetch: f,
    });
  }

  async post(path, body) {
    const res = await this.fetch(`${this.endpoint}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  /** @returns {Promise<{ payUrl: string }>} throws when MoMo refuses or is unreachable. */
  async createPayment({ orderId, amount, orderInfo }) {
    const p = {
      accessKey: this.accessKey,
      amount: String(amount),
      extraData: '',
      ipnUrl: this.ipnUrl,
      orderId,
      orderInfo,
      partnerCode: this.partnerCode,
      redirectUrl: this.redirectUrl,
      requestId: orderId,
      requestType: 'payWithMethod',
    };
    const raw = Object.keys(p).map((k) => `${k}=${p[k]}`).join('&');
    const { status, data } = await this.post('/v2/gateway/api/create', {
      partnerCode: p.partnerCode,
      requestId: p.requestId,
      amount: Number(amount),
      orderId,
      orderInfo,
      redirectUrl: p.redirectUrl,
      ipnUrl: p.ipnUrl,
      requestType: p.requestType,
      extraData: '',
      orderGroupId: '',
      autoCapture: true,
      lang: 'vi',
      signature: signMomo(raw, this.secretKey),
    });
    if (status !== 200 || data.resultCode !== 0 || !data.payUrl) {
      throw new Error(`momo create failed: http ${status}, resultCode ${data.resultCode ?? '-'}`);
    }
    return { payUrl: data.payUrl };
  }

  /** @returns {Promise<{ resultCode: number, transId: string|null, amount: number|null }>} */
  async queryPayment(orderId) {
    const requestId = crypto.randomUUID();
    const raw = `accessKey=${this.accessKey}&orderId=${orderId}&partnerCode=${this.partnerCode}&requestId=${requestId}`;
    const { status, data } = await this.post('/v2/gateway/api/query', {
      partnerCode: this.partnerCode,
      requestId,
      orderId,
      lang: 'vi',
      signature: signMomo(raw, this.secretKey),
    });
    if (status !== 200 || typeof data.resultCode !== 'number' || data.orderId !== orderId) {
      throw new Error(`momo query failed: http ${status}`);
    }
    return { resultCode: data.resultCode, transId: data.transId != null ? String(data.transId) : null, amount: data.amount ?? null };
  }

  /** True when the IPN body is signed with our secret key and names our partner code. */
  verifyIpn(body) {
    if (!body || typeof body.signature !== 'string' || body.partnerCode !== this.partnerCode) return false;
    const raw = `accessKey=${this.accessKey}&` + IPN_FIELDS.map((k) => `${k}=${body[k] ?? ''}`).join('&');
    const expected = Buffer.from(signMomo(raw, this.secretKey));
    const given = Buffer.from(body.signature);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }
}
