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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/studio/tours/${id}/publish`);
  const panel = page.getByRole('region', { name: 'Giá tải về offline' });
  await expect(panel).toContainText('Miễn phí');
  await expect(panel).toContainText('Đã bán 2 lượt · Doanh thu 50.000 ₫');

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
