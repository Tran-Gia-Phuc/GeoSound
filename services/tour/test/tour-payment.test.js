// =========================================================
// UC25 (#446) — paid offline package: price rules, MoMo signatures (fake fetch, never the network),
// purchase use cases with in-memory fakes (same semantics as PrismaTourPurchaseRepository), the
// package guards (UC03 tour package, UC07 itinerary package) and the HTTP routes with a stand-in
// for verifyJwt.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { normalizePrice, momoResultStatus, PURCHASE_STATUS } from '../src/domain/tour/tour-price.js';
import { MomoClient, signMomo, MOMO_SANDBOX } from '../src/infrastructure/payment/momo-client.js';
import {
  GetTourPrice,
  SetTourPrice,
  StartTourPurchase,
  GetMyPurchase,
  GetPaymentStatus,
  HandleMomoIpn,
} from '../src/application/use-cases/tour-payment.js';
import { GetTourPackage } from '../src/application/use-cases/get-tour-package.js';
import { GetItineraryPackage } from '../src/application/use-cases/get-itinerary-package.js';
import { TourPaymentController } from '../src/interfaces/http/controllers/tour-payment-controller.js';
import { buildTourPaymentRouter } from '../src/interfaces/http/routes/tour-payment-routes.js';

const T_PAID = '11111111-1111-4111-8111-111111111111';
const T_FREE = '22222222-2222-4222-8222-222222222222';
const T_DRAFT = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const AUTHOR = 'author-1';
const BUYER = 'buyer-1';
const CFG = { partnerCode: 'TESTPARTNER', accessKey: 'test-access', secretKey: 'test-secret' };
const REVISION = new Date('2026-11-01T00:00:00Z');

const makeTour = (id, { status = TOUR_STATUS.PUBLIC, price = 0 } = {}) =>
  new Tour({ id, title: `Tour ${id.slice(0, 4)}`, description: 'Mô tả', originalLanguage: 'vi', authorId: AUTHOR, status, price, updatedAt: REVISION });

class FakeTourRepo {
  constructor(tours) {
    this.rows = new Map(tours.map((t) => [t.id, t]));
  }
  async findById(id) {
    return this.rows.get(id) ?? null;
  }
  async findPublicById(id) {
    const t = this.rows.get(id);
    return t?.isPublic() ? t : null;
  }
  async setPrice(tour, price) {
    const t = this.rows.get(tour.id);
    t.price = price; // updated_at untouched, like PrismaTourRepository.setPrice
    return t;
  }
}

// Same semantics as PrismaTourPurchaseRepository (conditional status writes).
class FakePurchaseRepo {
  constructor(tourRepo) {
    this.tourRepo = tourRepo;
    this.rows = new Map();
  }
  async create({ tourId, userId, amount }) {
    const row = { id: crypto.randomUUID(), tourId, userId, amount, status: 'pending', transId: null, resultCode: null, paidAt: null };
    this.rows.set(row.id, row);
    return { ...row };
  }
  async findById(id) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async hasPaid(tourId, userId) {
    return [...this.rows.values()].some((r) => r.tourId === tourId && r.userId === userId && r.status === 'paid');
  }
  async lockedTourIds(userId, tourIds) {
    const out = [];
    for (const id of tourIds) {
      const t = this.tourRepo.rows.get(id);
      if (t && t.price > 0 && t.authorId !== userId && !(await this.hasPaid(id, userId))) out.push(id);
    }
    return out;
  }
  async markPaidIf(id, { transId, resultCode, paidAt }) {
    const r = this.rows.get(id);
    if (!r || !['pending', 'failed'].includes(r.status)) return 0;
    Object.assign(r, { status: 'paid', transId, resultCode, paidAt });
    return 1;
  }
  async markFailedIf(id, { resultCode }) {
    const r = this.rows.get(id);
    if (!r || r.status !== 'pending') return 0;
    Object.assign(r, { status: 'failed', resultCode });
    return 1;
  }
  async salesOf(tourId) {
    const paid = [...this.rows.values()].filter((r) => r.tourId === tourId && r.status === 'paid');
    return { paidCount: paid.length, revenue: paid.reduce((s, r) => s + r.amount, 0) };
  }
}

/** Fake MoMo: records the requests, answers create / query from the script. */
function fakeMomoFetch({ create = { resultCode: 0, payUrl: 'https://test-payment.momo.vn/pay/abc' }, query = null } = {}) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith('/v2/gateway/api/create')) return new Response(JSON.stringify(create), { status: 200 });
    if (url.endsWith('/v2/gateway/api/query')) {
      if (query instanceof Error) throw query;
      return new Response(JSON.stringify({ orderId: body.orderId, ...query }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  return { f, calls };
}

const momoWith = (f) => new MomoClient({ ...CFG, redirectUrl: 'http://localhost:5173/payment/momo', ipnUrl: 'https://demo.example/api/tours/payments/momo/ipn', fetch: f });

/** A MoMo IPN body signed like MoMo does. */
function signedIpn(orderId, amount, resultCode, overrides = {}) {
  const b = {
    partnerCode: CFG.partnerCode, orderId, requestId: orderId, amount, orderInfo: 'GeoSound', orderType: 'momo_wallet',
    transId: 4088878653, resultCode, message: 'ok', payType: 'qr', responseTime: 1731900000000, extraData: '', ...overrides,
  };
  const keys = ['amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];
  const raw = `accessKey=${CFG.accessKey}&` + keys.map((k) => `${k}=${b[k]}`).join('&');
  return { ...b, signature: signMomo(raw, CFG.secretKey) };
}

function kit({ momo = {} } = {}) {
  const tourRepo = new FakeTourRepo([
    makeTour(T_PAID, { price: 25000 }),
    makeTour(T_FREE),
    makeTour(T_DRAFT, { status: TOUR_STATUS.DRAFT }),
  ]);
  const purchaseRepo = new FakePurchaseRepo(tourRepo);
  const { f, calls } = fakeMomoFetch(momo ?? {});
  const client = momo === null ? null : momoWith(f);
  const clock = () => new Date('2026-11-18T08:00:00Z');
  return {
    tourRepo,
    purchaseRepo,
    calls,
    getPrice: new GetTourPrice({ tourRepo, purchaseRepo }),
    setPrice: new SetTourPrice({ tourRepo, purchaseRepo }),
    start: new StartTourPurchase({ tourRepo, purchaseRepo, momo: client }),
    mine: new GetMyPurchase({ tourRepo, purchaseRepo }),
    status: new GetPaymentStatus({ purchaseRepo, momo: client, clock }),
    ipn: new HandleMomoIpn({ purchaseRepo, momo: client, clock }),
  };
}

// ---------- domain ----------
test('price rules: 0 or 1 000..50 000 000 integer VND; MoMo result codes', () => {
  for (const ok of [0, 1000, 25000, 50_000_000]) assert.equal(normalizePrice(ok), ok);
  for (const bad of [1, 999, 50_000_001, -1000, 1000.5, '1000', null, undefined, NaN]) {
    assert.throws(() => normalizePrice(bad), { status: 400, code: 'validation_error' });
  }
  assert.equal(momoResultStatus(0), PURCHASE_STATUS.PAID);
  for (const c of [1000, 7000, 7002, 9000]) assert.equal(momoResultStatus(c), PURCHASE_STATUS.PENDING);
  for (const c of [1006, 1005, 11, 49, 99]) assert.equal(momoResultStatus(c), PURCHASE_STATUS.FAILED);
});

// ---------- MoMo client ----------
test('MoMo create: signed body in MoMo field order, payUrl returned; refusal throws', async () => {
  const { f, calls } = fakeMomoFetch();
  const client = momoWith(f);
  const out = await client.createPayment({ orderId: 'o-1', amount: 25000, orderInfo: 'GeoSound - Tour' });
  assert.equal(out.payUrl, 'https://test-payment.momo.vn/pay/abc');
  const { url, body } = calls[0];
  assert.equal(url, `${MOMO_SANDBOX}/v2/gateway/api/create`);
  const raw = `accessKey=${CFG.accessKey}&amount=25000&extraData=&ipnUrl=${body.ipnUrl}&orderId=o-1&orderInfo=GeoSound - Tour&partnerCode=${CFG.partnerCode}&redirectUrl=${body.redirectUrl}&requestId=o-1&requestType=payWithMethod`;
  assert.equal(body.signature, crypto.createHmac('sha256', CFG.secretKey).update(raw).digest('hex'));
  assert.equal(body.amount, 25000);
  assert.ok(!JSON.stringify(body).includes(CFG.secretKey));

  const refused = momoWith(fakeMomoFetch({ create: { resultCode: 22, message: 'amount' } }).f);
  await assert.rejects(refused.createPayment({ orderId: 'o-2', amount: 25000, orderInfo: 'x' }));
});

test('MoMo IPN signature: valid accepted, tampered amount / other partner / garbage refused', () => {
  const client = momoWith(async () => new Response('{}'));
  const ipn = signedIpn('o-1', 25000, 0);
  assert.equal(client.verifyIpn(ipn), true);
  assert.equal(client.verifyIpn({ ...ipn, amount: 1000 }), false);
  assert.equal(client.verifyIpn({ ...ipn, partnerCode: 'OTHER' }), false);
  assert.equal(client.verifyIpn({ ...ipn, signature: 'abc' }), false);
  assert.equal(client.verifyIpn(null), false);
  assert.equal(client.verifyIpn({ ...ipn, signature: undefined }), false);
});

test('MoMo fromEnv: null without keys; defaults to sandbox and the IPN under the return origin', () => {
  assert.equal(MomoClient.fromEnv({}), null);
  assert.equal(MomoClient.fromEnv({ MOMO_PARTNER_CODE: 'p', MOMO_ACCESS_KEY: 'a' }), null);
  const c = MomoClient.fromEnv({ MOMO_PARTNER_CODE: 'p', MOMO_ACCESS_KEY: 'a', MOMO_SECRET_KEY: 's', PAYMENT_RETURN_URL: 'https://demo.ngrok.app/payment/momo' });
  assert.equal(c.endpoint, MOMO_SANDBOX);
  assert.equal(c.ipnUrl, 'https://demo.ngrok.app/api/tours/payments/momo/ipn');
});

// ---------- use cases ----------
test('author price: owner only, kept updated_at, sales counted', async () => {
  const k = kit();
  assert.deepEqual(await k.getPrice.execute({ authorId: AUTHOR, tourId: T_DRAFT }), { price: 0, paidCount: 0, revenue: 0 });
  const r = await k.setPrice.execute({ authorId: AUTHOR, tourId: T_DRAFT, price: 15000 });
  assert.equal(r.price, 15000);
  assert.equal(k.tourRepo.rows.get(T_DRAFT).updatedAt, REVISION);
  await assert.rejects(k.setPrice.execute({ authorId: 'someone', tourId: T_DRAFT, price: 0 }), { status: 403 });
  await assert.rejects(k.setPrice.execute({ authorId: AUTHOR, tourId: UNKNOWN, price: 0 }), { status: 404 });
  await assert.rejects(k.setPrice.execute({ authorId: AUTHOR, tourId: T_DRAFT, price: 500 }), { status: 400 });
});

test('purchase: payUrl for a paid public tour; free / own / draft / already bought / no MoMo refused', async () => {
  const k = kit();
  const out = await k.start.execute({ tourId: T_PAID, userId: BUYER });
  assert.equal(out.payUrl, 'https://test-payment.momo.vn/pay/abc');
  const row = k.purchaseRepo.rows.get(out.orderId);
  assert.deepEqual([row.status, row.amount, row.userId], ['pending', 25000, BUYER]);
  assert.equal(k.calls[0].body.orderId, out.orderId);

  await assert.rejects(k.start.execute({ tourId: T_FREE, userId: BUYER }), { status: 400, code: 'tour_free' });
  await assert.rejects(k.start.execute({ tourId: T_PAID, userId: AUTHOR }), { status: 400, code: 'own_tour' });
  await assert.rejects(k.start.execute({ tourId: T_DRAFT, userId: BUYER }), { status: 404 });
  row.status = 'paid';
  await assert.rejects(k.start.execute({ tourId: T_PAID, userId: BUYER }), { status: 409, code: 'already_purchased' });

  const off = kit({ momo: null });
  await assert.rejects(off.start.execute({ tourId: T_PAID, userId: BUYER }), { status: 503, code: 'payment_unavailable' });
  assert.equal(off.purchaseRepo.rows.size, 0);

  const refused = kit({ momo: { create: { resultCode: 1001 } } });
  await assert.rejects(refused.start.execute({ tourId: T_PAID, userId: BUYER }), { status: 503 });
  assert.equal([...refused.purchaseRepo.rows.values()][0].status, 'failed');
});

test('IPN: signed success -> paid once; bad signature / amount refused; failure only from pending; late success wins', async () => {
  const k = kit();
  const { orderId } = await k.start.execute({ tourId: T_PAID, userId: BUYER });
  await assert.rejects(k.ipn.execute({ ...signedIpn(orderId, 25000, 0), signature: 'x' }), { status: 400, code: 'invalid_signature' });
  await assert.rejects(k.ipn.execute(signedIpn(orderId, 1000, 0)), { status: 400 });
  await assert.rejects(k.ipn.execute(signedIpn(UNKNOWN, 25000, 0)), { status: 404 });
  assert.equal(k.purchaseRepo.rows.get(orderId).status, 'pending');

  assert.equal((await k.ipn.execute(signedIpn(orderId, 25000, 1006))).status, 'failed');
  const late = await k.ipn.execute(signedIpn(orderId, 25000, 0));
  assert.equal(late.status, 'paid');
  const row = k.purchaseRepo.rows.get(orderId);
  assert.equal(row.transId, '4088878653');
  assert.equal(row.paidAt.toISOString(), '2026-11-18T08:00:00.000Z');
  assert.equal((await k.ipn.execute(signedIpn(orderId, 25000, 1006))).status, 'paid'); // never back
  assert.deepEqual(await k.mine.execute({ tourId: T_PAID, userId: BUYER }), { price: 25000, purchased: true, owner: false });
  assert.deepEqual(await k.getPrice.execute({ authorId: AUTHOR, tourId: T_PAID }), { price: 25000, paidCount: 1, revenue: 25000 });
});

test('status: asks MoMo while pending and applies the result; MoMo down or amount mismatch keeps pending', async () => {
  const paid = kit({ momo: { query: { resultCode: 0, transId: 77, amount: 25000 } } });
  const a = await paid.start.execute({ tourId: T_PAID, userId: BUYER });
  assert.deepEqual(await paid.status.execute({ orderId: a.orderId }), { orderId: a.orderId, tourId: T_PAID, status: 'paid', amount: 25000 });
  const calls = paid.calls.length;
  await paid.status.execute({ orderId: a.orderId });
  assert.equal(paid.calls.length, calls); // not pending any more: MoMo is not asked again

  const waiting = kit({ momo: { query: { resultCode: 1000, amount: 25000 } } });
  const b = await waiting.start.execute({ tourId: T_PAID, userId: BUYER });
  assert.equal((await waiting.status.execute({ orderId: b.orderId })).status, 'pending');

  const down = kit({ momo: { query: new Error('ECONNRESET') } });
  const c = await down.start.execute({ tourId: T_PAID, userId: BUYER });
  assert.equal((await down.status.execute({ orderId: c.orderId })).status, 'pending');

  const wrong = kit({ momo: { query: { resultCode: 0, amount: 1000 } } });
  const d = await wrong.start.execute({ tourId: T_PAID, userId: BUYER });
  assert.equal((await wrong.status.execute({ orderId: d.orderId })).status, 'pending');

  await assert.rejects(paid.status.execute({ orderId: UNKNOWN }), { status: 404, code: 'order_not_found' });
});

// ---------- package guards (UC03 / UC07) ----------
test('tour package: free for all; paid -> 401 anonymous, 402 not bought, 200 author and buyer', async () => {
  const k = kit();
  const repos = { placeRepo: { async listByTour() { return []; } }, routeConfigRepo: { async findByTour() { return null; } } };
  const pack = new GetTourPackage({ tourRepo: k.tourRepo, purchaseRepo: k.purchaseRepo, ...repos });
  assert.equal((await pack.execute({ id: T_FREE })).tourId, T_FREE);
  await assert.rejects(pack.execute({ id: T_PAID }), { status: 401, code: 'login_required' });
  await assert.rejects(pack.execute({ id: T_PAID, userId: BUYER }), { status: 402, code: 'payment_required' });
  assert.equal((await pack.execute({ id: T_PAID, userId: AUTHOR })).tourId, T_PAID);
  const { orderId } = await k.start.execute({ tourId: T_PAID, userId: BUYER });
  await k.ipn.execute(signedIpn(orderId, 25000, 0));
  const pkg = await pack.execute({ id: T_PAID, userId: BUYER });
  assert.equal(pkg.detail.price, 25000);
});

test('itinerary package: 402 while it holds places of a paid tour not bought; ok after buying', async () => {
  const k = kit();
  const itinerary = {
    id: 'it-1', updatedAt: REVISION, isOwnedBy: (u) => u === BUYER,
    items: [T_FREE, T_PAID].map((tourId, i) => ({
      id: `i${i}`, placeId: `p${i}`, tourId, name: `Điểm ${i}`, type: 'other', lat: 16, lng: 108, images: [], radiusMeters: 50,
      availableLanguages: ['vi'], sequence: i, createdAt: REVISION,
      localized: () => ({ text: 'x', audioUrl: null, audioSource: null }),
    })),
  };
  const pack = new GetItineraryPackage({ itineraryRepo: { async findById() { return itinerary; } }, purchaseRepo: k.purchaseRepo });
  await assert.rejects(pack.execute({ ownerId: BUYER, itineraryId: 'it-1' }), { status: 402, code: 'payment_required' });
  const { orderId } = await k.start.execute({ tourId: T_PAID, userId: BUYER });
  await k.ipn.execute(signedIpn(orderId, 25000, 0));
  assert.equal((await pack.execute({ ownerId: BUYER, itineraryId: 'it-1' })).kind, 'itinerary');
});

// ---------- HTTP ----------
// Same rules as shared verifyJwt: 401 without a token, 403 for another role. Token = "<role>:<sub>".
const fakeGuard = (roles) => (req, res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const [role, sub] = h.slice(7).split(':');
  if (roles && !roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
  req.user = { sub, role };
  next();
};

async function withServer(k, fn) {
  const controller = new TourPaymentController({
    getTourPrice: k.getPrice, setTourPrice: k.setPrice, startTourPurchase: k.start,
    getMyPurchase: k.mine, getPaymentStatus: k.status, handleMomoIpn: k.ipn,
  });
  const app = express();
  app.use(express.json());
  app.use('/', buildTourPaymentRouter({ tourPaymentController: controller, requireAuth: fakeGuard(null), requireContributor: fakeGuard(['contributor']) }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(async (path, { method = 'GET', token, body } = {}) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('router: guards, validation, purchase, IPN 204, public status', async () => {
  const k = kit();
  await withServer(k, async (call) => {
    const author = `contributor:${AUTHOR}`;
    const buyer = `tourist:${BUYER}`;
    assert.equal((await call(`/mine/${T_DRAFT}/price`)).status, 401);
    assert.equal((await call(`/mine/${T_DRAFT}/price`, { token: buyer })).status, 403);
    assert.equal((await call(`/mine/${T_DRAFT}/price`, { method: 'PUT', token: author, body: { price: '1000' } })).status, 400);
    const put = await call(`/mine/${T_DRAFT}/price`, { method: 'PUT', token: author, body: { price: 1000 } });
    assert.deepEqual([put.status, put.body.price], [200, 1000]);

    assert.equal((await call(`/${T_PAID}/purchase`, { method: 'POST' })).status, 401);
    const buy = await call(`/${T_PAID}/purchase`, { method: 'POST', token: buyer });
    assert.equal(buy.status, 201);
    assert.ok(buy.body.payUrl);
    assert.equal((await call(`/${T_FREE}/purchase`, { method: 'POST', token: buyer })).body.code, 'tour_free');

    assert.equal((await call('/payments/momo/ipn', { method: 'POST', body: { orderId: buy.body.orderId } })).status, 400);
    const ipn = await call('/payments/momo/ipn', { method: 'POST', body: signedIpn(buy.body.orderId, 25000, 0) });
    assert.equal(ipn.status, 204);
    const st = await call(`/payments/${buy.body.orderId}`);
    assert.deepEqual([st.status, st.body.status], [200, 'paid']);
    assert.equal((await call('/payments/not-a-uuid')).status, 400);
    const mine = await call(`/${T_PAID}/purchase/mine`, { token: buyer });
    assert.equal(mine.body.purchased, true);
    assert.equal((await call(`/${T_PAID}/purchase`, { method: 'POST', token: buyer })).status, 409);
  });
});
