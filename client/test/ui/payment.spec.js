// UC25 (#446): buy a paid tour with MoMo before downloading it offline; return page; Studio price.
import { test, expect } from '@playwright/test';
import { id, tour, json, signIn, fixtures, noOverflow } from './fixtures.js';

const ORDER = '44444444-4444-4444-8444-444444444444';
const AUTHOR = '55555555-5555-4555-8555-555555555555';
const PAY_URL = 'https://test-payment.momo.vn/v2/gateway/pay?t=abc';

/** Public tour with a price, written by someone else. */
async function paidTour(page, { purchased = false, buy } = {}) {
  const log = { buys: 0 };
  await fixtures(page);
  await page.route(
    (u) => u.pathname === `/api/tours/${id}`,
    (route) => json(route, { tour: { ...tour, status: 'public', authorId: AUTHOR, price: 25000 } }),
  );
  await page.route(`**/api/tours/${id}/purchase/mine`, (route) => json(route, { price: 25000, purchased, owner: false }));
  await page.route(`**/api/tours/${id}/purchase`, (route) => {
    log.buys += 1;
    return buy ? buy(route) : json(route, { orderId: ORDER, payUrl: PAY_URL }, 201);
  });
  await page.route('https://test-payment.momo.vn/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>MoMo sandbox</h1>' }),
  );
  return log;
}

const gate = (page) => page.getByRole('region', { name: 'Mua tour để tải về' });
const download = (page) => page.getByRole('region', { name: 'Tải về để nghe offline' });

test('anonymous visitor sees the price and a sign-in link, not the download (390 px)', async ({ page }) => {
  await paidTour(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tour/${id}`);
  await expect(gate(page)).toContainText('25.000 ₫');
  await expect(gate(page)).toContainText('Nghe trực tuyến vẫn miễn phí');
  const login = gate(page).getByRole('link', { name: 'Đăng nhập để mua' });
  await expect(login).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/tour/${id}`)}`);
  await expect(download(page)).toHaveCount(0);
  await noOverflow(page);
});

test('signed-in tourist buys with MoMo: POST purchase then the browser goes to payUrl', async ({ page }) => {
  await signIn(page, 'tourist');
  const log = await paidTour(page);
  await page.goto(`/tour/${id}`);
  await gate(page).getByRole('button', { name: 'Mua với MoMo' }).click();
  await page.waitForURL(PAY_URL);
  await expect(page.getByText('MoMo sandbox')).toBeVisible();
  expect(log.buys).toBe(1);
});

test('MoMo not configured: the error is shown and the button stays', async ({ page }) => {
  await signIn(page, 'tourist');
  await paidTour(page, {
    buy: (route) => json(route, { error: 'Thanh toán đang tạm ngưng, vui lòng thử lại sau', code: 'payment_unavailable' }, 503),
  });
  await page.goto(`/tour/${id}`);
  await gate(page).getByRole('button', { name: 'Mua với MoMo' }).click();
  await expect(gate(page).getByRole('alert')).toContainText('Thanh toán đang tạm ngưng');
  await expect(gate(page).getByRole('button', { name: 'Mua với MoMo' })).toBeEnabled();
});

test('a buyer sees the normal download block', async ({ page }) => {
  await signIn(page, 'tourist');
  await paidTour(page, { purchased: true });
  await page.goto(`/tour/${id}`);
  await expect(page.getByText('Bạn đã mua tour này')).toBeVisible();
  await expect(download(page).getByRole('button', { name: 'Tải xuống' })).toBeVisible();
  await expect(gate(page)).toHaveCount(0);
});

test('free tour: download block as before, no purchase call', async ({ page }) => {
  let asked = 0;
  await signIn(page, 'tourist');
  await fixtures(page);
  await page.route(`**/api/tours/${id}/purchase/mine`, (route) => {
    asked += 1;
    return json(route, { price: 0, purchased: true, owner: false });
  });
  await page.goto(`/tour/${id}`);
  await expect(download(page).getByRole('button', { name: 'Tải xuống' })).toBeVisible();
  await expect(gate(page)).toHaveCount(0);
  expect(asked).toBe(0);
});

test('return page polls while pending, then shows the success and a link to the tour', async ({ page }) => {
  let calls = 0;
  await fixtures(page);
  await page.route(`**/api/tours/payments/${ORDER}`, (route) => {
    calls += 1;
    return json(route, { orderId: ORDER, tourId: id, amount: 25000, status: calls < 2 ? 'pending' : 'paid' });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/payment/momo?partnerCode=MOMO&orderId=${ORDER}&resultCode=0`);
  await expect(page.getByText('Thanh toán thành công 25.000 ₫')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Về trang tour để tải' })).toHaveAttribute('href', `/tour/${id}`);
  expect(calls).toBe(2);
  await noOverflow(page);
});

test('return page: a failed or cancelled payment says so', async ({ page }) => {
  await fixtures(page);
  await page.route(`**/api/tours/payments/${ORDER}`, (route) =>
    json(route, { orderId: ORDER, tourId: id, amount: 25000, status: 'failed' }),
  );
  await page.goto(`/payment/momo?orderId=${ORDER}&resultCode=1006`);
  await expect(page.getByRole('alert')).toContainText('Thanh toán chưa thành công hoặc đã bị huỷ');
  await expect(page.getByRole('link', { name: 'Quay lại tour' })).toBeVisible();
});

test('Studio: the author sets a price (validation, PUT body) and sees the sales', async ({ page }) => {
  const bodies = [];
  await signIn(page);
  await fixtures(page);
  await page.route(`**/api/tours/mine/${id}/price`, (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      bodies.push(req.postDataJSON());
      return json(route, { price: req.postDataJSON().price, paidCount: 2, revenue: 50000 });
    }
    return json(route, { price: 0, paidCount: 2, revenue: 50000 });
  });
  await page.route(`**/api/tours/mine/${id}/sales`, (route) =>
    json(route, {
      items: [
        { orderId: ORDER, amount: 25000, paidAt: '2026-11-18T08:00:00.000Z', buyer: 'a1b2c3' },
        { orderId: AUTHOR, amount: 25000, paidAt: '2026-11-17T08:00:00.000Z', buyer: 'd4e5f6' },
      ],
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/studio/tours/${id}/publish`);
  const panel = page.getByRole('region', { name: 'Giá tải về offline' });
  await expect(panel).toContainText('Miễn phí');
  await expect(panel).toContainText('Đã bán 2 lượt · Doanh thu 50.000 ₫');
  const sales = panel.getByRole('list', { name: 'Đơn đã bán' });
  await expect(sales.getByRole('listitem')).toHaveCount(2);
  await expect(sales.getByRole('listitem').first()).toContainText('Người mua …a1b2c3');

  const field = panel.getByLabel('Giá (VND, 0 = miễn phí)');
  await field.fill('500');
  await panel.getByRole('button', { name: 'Lưu giá' }).click();
  await expect(panel.getByRole('alert')).toContainText('Giá phải là 0 (miễn phí)');
  expect(bodies).toHaveLength(0);

  await field.fill('25.000');
  await panel.getByRole('button', { name: 'Lưu giá' }).click();
  await expect(page.locator('.toast-region')).toContainText('Đã đặt giá 25.000 ₫');
  expect(bodies).toEqual([{ price: 25000 }]);
  await expect(panel.locator('.chip')).toHaveText('25.000 ₫');
  await noOverflow(page);
});

test('purchase history: every order with its status; paid links to the tour, pending to the return page (390 px)', async ({ page }) => {
  await signIn(page, 'tourist');
  await fixtures(page);
  const PENDING = '66666666-6666-4666-8666-666666666666';
  await page.route('**/api/tours/purchases/mine', (route) =>
    json(route, {
      items: [
        { orderId: PENDING, tourId: id, tourTitle: 'Tour đang chờ', status: 'pending', amount: 35000, transId: null, createdAt: '2026-11-19T08:00:00.000Z', paidAt: null },
        { orderId: ORDER, tourId: id, tourTitle: 'Hà Nội ngàn năm văn hiến', status: 'paid', amount: 49000, transId: '4088878653', createdAt: '2026-11-18T07:59:00.000Z', paidAt: '2026-11-18T08:00:00.000Z' },
        { orderId: AUTHOR, tourId: id, tourTitle: null, status: 'failed', amount: 25000, transId: null, createdAt: '2026-11-17T08:00:00.000Z', paidAt: null },
      ],
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await page.getByRole('link', { name: /Lịch sử giao dịch/ }).click();
  await expect(page).toHaveURL(/\/account\/purchases$/);

  const rows = page.getByTestId('purchase-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Đang chờ');
  await expect(rows.nth(0).getByRole('link', { name: 'Kiểm tra lại' })).toHaveAttribute('href', `/payment/momo?orderId=${PENDING}`);
  await expect(rows.nth(1)).toContainText('Đã thanh toán');
  await expect(rows.nth(1)).toContainText('49.000 ₫');
  await expect(rows.nth(1)).toContainText('Mã MoMo 4088878653');
  await expect(rows.nth(1).getByRole('link', { name: 'Hà Nội ngàn năm văn hiến' })).toHaveAttribute('href', `/tour/${id}`);
  await expect(rows.nth(2)).toContainText('Thất bại');
  await expect(rows.nth(2)).toContainText('Tour không còn khả dụng');
  await noOverflow(page);
});

test('purchase history: empty state', async ({ page }) => {
  await signIn(page, 'tourist');
  await fixtures(page);
  await page.route('**/api/tours/purchases/mine', (route) => json(route, { items: [] }));
  await page.goto('/account/purchases');
  await expect(page.getByText('Bạn chưa mua tour nào.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Khám phá tour' })).toBeVisible();
});
