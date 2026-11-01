// #265: admin view of online devices, and the heartbeat that keeps a device "online".
import { test, expect } from '@playwright/test';
import { json, signIn, fixtures, noOverflow } from './fixtures.js';

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

const people = [
  { id: 'u1', email: 'an@example.test', fullName: 'Nguyễn An', role: 'tourist' },
  { id: 'u2', email: 'binh@example.test', fullName: 'Trần Bình', role: 'contributor' },
];
const online = [
  ['s1', 'Chrome trên Android', 0], ['s2', 'Safari trên iPhone', 0], ['s3', 'Chrome trên Windows', 1],
  ['s4', 'Firefox trên Linux', 1], ['s5', 'Edge trên Windows', 1],
].map(([id, deviceName, user], i) => ({
  id, deviceName, location: i === 0 ? 'Hà Nội, Việt Nam' : null,
  createdAt: minutesAgo(90), lastActiveAt: minutesAgo(0), user: people[user],
}));
const report = {
  at: new Date().toISOString(),
  onlineWindowSeconds: 120,
  totals: { devicesSeen: 20, signedIn: 8, online: 5, onlineAccounts: 2 },
  online,
};

async function mockAdmin(page, handler) {
  const calls = [];
  await fixtures(page);
  await page.route('**/api/auth/admin/sessions', (route) => {
    calls.push(route.request().method());
    return handler ? handler(route) : json(route, report);
  });
  return calls;
}

test('admin sees online / signed-in / known counts and the online device table', async ({ page }) => {
  await signIn(page, 'admin');
  await mockAdmin(page);
  await page.goto('/admin/devices');
  const stats = page.getByTestId('admin-stat');
  await expect(stats).toHaveCount(4);
  await expect(stats.nth(0)).toContainText('Đang online');
  await expect(stats.nth(0)).toContainText('5');
  await expect(stats.nth(1)).toContainText('2');
  await expect(stats.nth(2)).toContainText('8');
  await expect(stats.nth(3)).toContainText('20');
  const rows = page.getByTestId('online-row');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('Chrome trên Android');
  await expect(rows.first()).toContainText('an@example.test');
  await expect(rows.first()).toContainText('Hà Nội, Việt Nam');
  await expect(rows.nth(1)).toContainText('Không xác định');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});

test('no device online shows an empty message', async ({ page }) => {
  await signIn(page, 'admin');
  await mockAdmin(page, (route) => json(route, { ...report, totals: { ...report.totals, online: 0, onlineAccounts: 0 }, online: [] }));
  await page.goto('/admin/devices');
  await expect(page.getByText('Hiện không có thiết bị nào online.')).toBeVisible();
});

test('non-admin gets a notice and the admin API is not called', async ({ page }) => {
  await signIn(page, 'contributor');
  const calls = await mockAdmin(page);
  await page.goto('/admin/devices');
  await expect(page.getByRole('alert')).toContainText('Chỉ quản trị viên');
  expect(calls).toHaveLength(0);
});

test('a 403 from the API is shown as a notice with retry', async ({ page }) => {
  await signIn(page, 'admin');
  await mockAdmin(page, (route) => json(route, { error: 'Forbidden' }, 403));
  await page.goto('/admin/devices');
  await expect(page.getByRole('alert')).toContainText('Chỉ quản trị viên');
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
});

test('account page links to the admin view only for admins', async ({ page, context }) => {
  await signIn(page, 'admin');
  await fixtures(page);
  await page.goto('/account');
  await expect(page.getByRole('link', { name: /Thiết bị đang online/ })).toBeVisible();

  const other = await context.newPage();
  await signIn(other, 'tourist');
  await fixtures(other);
  await other.goto('/account');
  await expect(other.getByRole('link', { name: 'Thiết bị đang đăng nhập' })).toBeVisible();
  await expect(other.getByRole('link', { name: /Thiết bị đang online/ })).toHaveCount(0);
});

test('a signed-in device sends a heartbeat every minute while visible, none when signed out', async ({ page }) => {
  await page.clock.install();
  await signIn(page, 'tourist');
  await fixtures(page);
  const beats = [];
  await page.route('**/api/auth/sessions/heartbeat', (route) => {
    beats.push(route.request().headers().authorization);
    return route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await page.clock.runFor(30_000);
  expect(beats).toHaveLength(0); // sign-in / refresh already mark activity: first beat after one interval
  await page.clock.runFor(31_000);
  await expect.poll(() => beats.length).toBe(1);
  expect(beats[0]).toBe('Bearer test-access');
  await page.clock.runFor(60_000);
  await expect.poll(() => beats.length).toBe(2);

  const guest = await page.context().newPage();
  await guest.clock.install();
  await fixtures(guest);
  const guestBeats = [];
  await guest.route('**/api/auth/sessions/heartbeat', (route) => {
    guestBeats.push(1);
    return route.fulfill({ status: 204 });
  });
  await guest.addInitScript(() => localStorage.removeItem('geosound:auth'));
  await guest.goto('/');
  await guest.clock.runFor(130_000);
  expect(guestBeats).toHaveLength(0);
});
