// #265: admin view of online devices, and the beat that keeps a device "online".
// #329: visitors who are not signed in count too (presence beat from every page, leave beacon).
import { test, expect } from '@playwright/test';
import { json, signIn, fixtures, noOverflow } from './fixtures.js';

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
const sessionTotals = { devicesSeen: 20, signedIn: 8, online: 5, onlineAccounts: 2 };
const presenceTotals = { onlineDevices: 9, onlineGuests: 4, activeToday: 31, active7Days: 120, active30Days: 410 };
const noPresence = { onlineDevices: null, onlineGuests: null, activeToday: null, active7Days: null, active30Days: null };
const report = {
  at: new Date().toISOString(),
  onlineWindowSeconds: 120,
  totals: { ...sessionTotals, ...presenceTotals },
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

test('admin sees online devices with guests, accounts, signed in, daily visitors and the online table', async ({ page }) => {
  await signIn(page, 'admin');
  await mockAdmin(page);
  await page.goto('/admin/devices');
  const stats = page.getByTestId('admin-stat');
  await expect(stats).toHaveCount(6);
  await expect(stats.nth(0)).toContainText('Đang online');
  await expect(stats.nth(0)).toContainText('9');
  await expect(stats.nth(0)).toContainText('Hoạt động trong 2 phút qua');
  await expect(stats.nth(1)).toContainText('Khách chưa đăng nhập');
  await expect(stats.nth(1)).toContainText('4');
  await expect(stats.nth(2)).toContainText('2');
  await expect(stats.nth(3)).toContainText('8');
  await expect(stats.nth(4)).toContainText('31');
  await expect(stats.nth(4)).toContainText('7 ngày: 120 · 30 ngày: 410');
  await expect(stats.nth(5)).toContainText('Thiết bị đã đăng nhập');
  await expect(stats.nth(5)).toContainText('20');
  await expect(page.getByText('Chưa đếm được khách chưa đăng nhập')).toHaveCount(0);
  const rows = page.getByTestId('online-row');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('Chrome trên Android');
  await expect(rows.first()).toContainText('an@example.test');
  await expect(rows.first()).toContainText('Hà Nội, Việt Nam');
  await expect(rows.nth(1)).toContainText('Không xác định');
  await expect(page.getByTestId('guest-note')).toContainText('4 khách chưa đăng nhập');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});

test('without presence data the online count falls back to signed-in devices and says so', async ({ page }) => {
  await signIn(page, 'admin');
  await mockAdmin(page, (route) => json(route, { ...report, totals: { ...sessionTotals, ...noPresence } }));
  await page.goto('/admin/devices');
  const stats = page.getByTestId('admin-stat');
  await expect(stats.nth(0)).toContainText('5');
  await expect(stats.nth(0)).toContainText('Chỉ thiết bị đã đăng nhập');
  await expect(stats.nth(1)).toContainText('–');
  await expect(page.getByText('Chưa đếm được khách chưa đăng nhập')).toBeVisible();
  await expect(page.getByTestId('guest-note')).toHaveCount(0);
});

test('nothing online shows an empty message; only guests online says no signed-in device', async ({ page }) => {
  await signIn(page, 'admin');
  const empty = { ...sessionTotals, online: 0, onlineAccounts: 0, ...presenceTotals, onlineDevices: 0, onlineGuests: 0 };
  let totals = empty;
  await mockAdmin(page, (route) => json(route, { ...report, totals, online: [] }));
  await page.goto('/admin/devices');
  await expect(page.getByText('Hiện không có thiết bị nào online.')).toBeVisible();

  totals = { ...empty, onlineDevices: 3, onlineGuests: 3 };
  await page.reload();
  await expect(page.getByText('Không có thiết bị đã đăng nhập nào online.')).toBeVisible();
  await expect(page.getByTestId('guest-note')).toContainText('3 khách');
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

test('every visitor sends a presence beat at once and every minute; signed in, with the token', async ({ page }) => {
  await page.clock.install();
  await fixtures(page);
  const beats = [];
  await page.route('**/api/auth/presence', (route) => {
    beats.push({ auth: route.request().headers().authorization, body: route.request().postDataJSON() });
    return route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await expect.poll(() => beats.length).toBe(1);
  expect(beats[0].auth).toBeUndefined(); // not signed in: still counted
  expect(beats[0].body.deviceId).toMatch(UUID);
  await page.clock.runFor(30_000);
  expect(beats).toHaveLength(1);
  await page.clock.runFor(31_000);
  await expect.poll(() => beats.length).toBe(2);
  expect(beats[1].body.deviceId).toBe(beats[0].body.deviceId);

  const member = await page.context().newPage();
  await member.clock.install();
  await signIn(member, 'tourist');
  await fixtures(member);
  const memberBeats = [];
  await member.route('**/api/auth/presence', (route) => {
    memberBeats.push(route.request().headers().authorization);
    return route.fulfill({ status: 204 });
  });
  await member.goto('/');
  await expect.poll(() => memberBeats.length).toBe(1);
  expect(memberBeats[0]).toBe('Bearer test-access');
});

test('a hidden tab beats only while audio plays; closing the page sends a leave beacon', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.__hidden = false;
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get: () => (window.__hidden ? 'hidden' : 'visible'),
    });
    window.__beacons = [];
    navigator.sendBeacon = (url, data) => {
      window.__beacons.push({ url: String(url), data: String(data) });
      return true;
    };
  });
  await fixtures(page);
  const beats = [];
  await page.route('**/api/auth/presence', (route) => {
    beats.push(1);
    return route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await expect.poll(() => beats.length).toBe(1);

  await page.evaluate(() => {
    window.__hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(125_000);
  expect(beats).toHaveLength(1);

  // A tour plays with the screen locked: the player reports playback (same module as the app's).
  await page.evaluate(async () => {
    const presence = await import('/src/lib/presence.js');
    presence.setMediaPlaying(window, true);
  });
  await page.clock.runFor(61_000);
  await expect.poll(() => beats.length).toBe(2);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  const beacons = await page.evaluate(() => window.__beacons);
  expect(beacons).toHaveLength(1);
  expect(beacons[0].url).toContain('/api/auth/presence/leave');
  expect(JSON.parse(beacons[0].data).deviceId).toMatch(UUID);
});
