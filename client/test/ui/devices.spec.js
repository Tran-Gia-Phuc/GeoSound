// UC23: signed-in devices screen, deviceId on login/refresh, revoked session.
import { test, expect } from '@playwright/test';
import { userId, json, signIn, fixtures, noOverflow } from './fixtures.js';

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

const current = {
  id: 'sess-current',
  deviceName: 'Chrome trên Windows',
  location: 'Hà Nội, Việt Nam',
  createdAt: minutesAgo(600),
  lastActiveAt: minutesAgo(0),
  current: true,
};
const phone = {
  id: 'sess-phone',
  deviceName: 'Safari trên iPhone',
  location: null,
  createdAt: minutesAgo(3000),
  lastActiveAt: minutesAgo(5),
  current: false,
};
const tablet = {
  id: 'sess-tablet',
  deviceName: 'Firefox trên Android',
  location: 'Đà Nẵng, Việt Nam',
  createdAt: minutesAgo(9000),
  lastActiveAt: minutesAgo(60 * 26),
  current: false,
};

/** Mocks /api/auth/sessions*; `handlers` override single endpoints. */
async function mockSessions(page, sessions, handlers = {}) {
  const state = { sessions: [...sessions], calls: [] };
  await fixtures(page);
  await page.route('**/api/auth/sessions**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    state.calls.push(`${method} ${path}`);
    if (method === 'GET' && path === '/api/auth/sessions') {
      if (handlers.list) return handlers.list(route, state);
      return json(route, { sessions: state.sessions });
    }
    if (method === 'POST' && path === '/api/auth/sessions/revoke-others') {
      if (handlers.others) return handlers.others(route, state);
      const revoked = state.sessions.filter((s) => !s.current).length;
      state.sessions = state.sessions.filter((s) => s.current);
      return json(route, { revoked });
    }
    if (method === 'DELETE') {
      const sid = decodeURIComponent(path.split('/').pop());
      if (handlers.revoke) return handlers.revoke(route, state, sid);
      state.sessions = state.sessions.filter((s) => s.id !== sid);
      return route.fulfill({ status: 204 });
    }
    return json(route, { error: 'unexpected' }, 404);
  });
  return state;
}

const rows = (page) => page.getByTestId('device-row');
const toast = (page, text) => page.locator('.toast-region').filter({ hasText: text });
const confirmSignOut = (page) =>
  page.getByRole('dialog').getByRole('button', { name: 'Đăng xuất', exact: true }).click();

test('account links to the devices screen; list order, badge and details', async ({ page }) => {
  await signIn(page, 'tourist');
  // Unsorted on purpose: the current device must come first, then by last activity.
  await mockSessions(page, [tablet, current, phone]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await page.getByRole('link', { name: 'Thiết bị đang đăng nhập' }).click();
  await expect(page).toHaveURL(/\/account\/devices$/);
  await expect(rows(page)).toHaveCount(3);
  const first = rows(page).nth(0);
  await expect(first).toContainText('Chrome trên Windows');
  await expect(first).toContainText('Thiết bị này');
  await expect(first).toContainText('Đang hoạt động');
  await expect(first).toContainText('Hà Nội, Việt Nam');
  await expect(first).toContainText('Đăng nhập lúc');
  await expect(first.getByRole('button')).toHaveCount(0);
  await expect(rows(page).nth(1)).toContainText('Safari trên iPhone');
  await expect(rows(page).nth(1)).toContainText('Không xác định');
  await expect(rows(page).nth(1)).toContainText('5 phút trước');
  await expect(rows(page).nth(1)).not.toContainText('Thiết bị này');
  await expect(rows(page).nth(2)).toContainText('Firefox trên Android');
  await expect(rows(page).nth(2)).toContainText('1 ngày trước');
  await noOverflow(page);
});

test('sign out one device after confirmation', async ({ page }) => {
  await signIn(page, 'tourist');
  const state = await mockSessions(page, [current, phone, tablet]);
  await page.goto('/account/devices');
  await page.getByRole('button', { name: 'Đăng xuất thiết bị Safari trên iPhone' }).click();
  await expect(page.getByRole('dialog')).toContainText('Đăng xuất khỏi Safari trên iPhone?');
  await confirmSignOut(page);
  await expect(toast(page, 'Đã đăng xuất Safari trên iPhone')).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).filter({ hasText: 'Safari trên iPhone' })).toHaveCount(0);
  expect(state.calls).toContain('DELETE /api/auth/sessions/sess-phone');
});

test('cancel keeps the device', async ({ page }) => {
  await signIn(page, 'tourist');
  const state = await mockSessions(page, [current, phone]);
  await page.goto('/account/devices');
  await page.getByRole('button', { name: 'Đăng xuất thiết bị Safari trên iPhone' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Huỷ' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(2);
  expect(state.calls.some((c) => c.startsWith('DELETE'))).toBeFalsy();
});

test('E1: only this device hides the sign-out-all button', async ({ page }) => {
  await signIn(page, 'tourist');
  await mockSessions(page, [current]);
  await page.goto('/account/devices');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Thiết bị này');
  await expect(page.getByRole('button', { name: 'Đăng xuất tất cả thiết bị khác' })).toHaveCount(0);
});

test('A1: sign out all other devices with the count', async ({ page }) => {
  await signIn(page, 'tourist');
  const state = await mockSessions(page, [current, phone, tablet]);
  await page.goto('/account/devices');
  await page.getByRole('button', { name: 'Đăng xuất tất cả thiết bị khác' }).click();
  await expect(page.getByRole('dialog')).toContainText('Đăng xuất 2 thiết bị khác?');
  await confirmSignOut(page);
  await expect(toast(page, 'Đã đăng xuất 2 thiết bị')).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Thiết bị này');
  await expect(page.getByRole('button', { name: 'Đăng xuất tất cả thiết bị khác' })).toHaveCount(0);
  expect(state.calls).toContain('POST /api/auth/sessions/revoke-others');
});

test('E2: device already signed out shows a notice and reloads the list', async ({ page }) => {
  await signIn(page, 'tourist');
  const state = await mockSessions(page, [current, phone, tablet], {
    revoke: (route, st, sid) => {
      // Signed out elsewhere meanwhile: the server no longer knows it.
      st.sessions = st.sessions.filter((s) => s.id !== sid);
      return json(route, { error: 'Session not found' }, 404);
    },
  });
  await page.goto('/account/devices');
  await expect(rows(page)).toHaveCount(3);
  const lists = () => state.calls.filter((c) => c === 'GET /api/auth/sessions').length;
  const before = lists();
  await page.getByRole('button', { name: 'Đăng xuất thiết bị Safari trên iPhone' }).click();
  await confirmSignOut(page);
  await expect(toast(page, 'Thiết bị này đã đăng xuất')).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  expect(lists()).toBe(before + 1);
});

test('E3: network error keeps the list unchanged', async ({ page }) => {
  await signIn(page, 'tourist');
  await mockSessions(page, [current, phone], {
    revoke: (route) => route.abort('failed'),
    others: (route) => route.abort('failed'),
  });
  await page.goto('/account/devices');
  await page.getByRole('button', { name: 'Đăng xuất thiết bị Safari trên iPhone' }).click();
  await confirmSignOut(page);
  await expect(toast(page, 'Không thể kết nối, vui lòng thử lại')).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Đăng xuất tất cả thiết bị khác' }).click();
  await confirmSignOut(page);
  await expect(toast(page, 'Không thể kết nối, vui lòng thử lại')).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
});

test('list load failure shows an error with retry', async ({ page }) => {
  await signIn(page, 'tourist');
  let fail = true;
  await mockSessions(page, [current], {
    list: (route, st) => (fail ? route.abort('failed') : json(route, { sessions: st.sessions })),
  });
  await page.goto('/account/devices');
  await expect(page.getByRole('alert')).toContainText('Không thể kết nối, vui lòng thử lại');
  fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page)).toHaveCount(1);
});

test('devices screen requires sign-in', async ({ page }) => {
  await fixtures(page);
  await page.goto('/account/devices');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fdevices/);
});

test('login and refresh send the same stored deviceId', async ({ page }) => {
  await fixtures(page);
  let loginBody;
  let refreshBody;
  await page.route('**/api/auth/login', (route) => {
    loginBody = route.request().postDataJSON();
    return json(route, {
      user: { id: userId, role: 'tourist', fullName: 'Test' },
      accessToken: 'expired-access',
      refreshToken: 'test-refresh',
    });
  });
  await page.route('**/api/auth/refresh', (route) => {
    refreshBody = route.request().postDataJSON();
    return json(route, { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' });
  });
  // The first list call gets 401 (expired access token) -> refresh -> retry.
  await page.route('**/api/auth/sessions', (route) => {
    const auth = route.request().headers().authorization;
    if (auth !== 'Bearer fresh-access') return json(route, { code: 'token_expired', error: 'Expired' }, 401);
    return json(route, { sessions: [current] });
  });
  await page.goto('/login?next=%2Faccount%2Fdevices');
  await page.getByLabel('Email', { exact: true }).fill('test@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Password123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/devices$/);
  await expect(rows(page)).toHaveCount(1);
  const stored = await page.evaluate(() => localStorage.getItem('geosound.deviceId'));
  expect(stored).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(loginBody.deviceId).toBe(stored);
  expect(refreshBody).toEqual({ refreshToken: 'test-refresh', deviceId: stored });
});

test('two tabs refreshing at once rotate the refresh token only once', async ({ context }) => {
  // Auth signs a session out when an already-rotated refresh token is used again.
  const server = { valid: 'test-refresh', gen: 0, calls: 0 };
  const tabs = [await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    await fixtures(tab);
    await tab.route('**/api/auth/sessions', (route) => {
      const auth = route.request().headers().authorization ?? '';
      if (!auth.startsWith('Bearer fresh-access')) return json(route, { code: 'token_expired', error: 'Expired' }, 401);
      return json(route, { sessions: [current] });
    });
    await tab.route('**/api/auth/refresh', async (route) => {
      server.calls += 1;
      const { refreshToken } = route.request().postDataJSON();
      if (refreshToken !== server.valid) return json(route, { code: 'session_revoked', error: 'reuse' }, 401);
      server.gen += 1;
      server.valid = `fresh-refresh-${server.gen}`;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return json(route, { accessToken: `fresh-access-${server.gen}`, refreshToken: server.valid });
    });
  }
  await tabs[0].goto('/');
  await tabs[0].evaluate((id) => localStorage.setItem('geosound:auth', JSON.stringify({
    user: { id, fullName: 'Test', email: 'test@example.test', role: 'tourist' },
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
  })), userId);
  await Promise.all(tabs.map((tab) => tab.goto('/account/devices')));
  for (const tab of tabs) await expect(rows(tab)).toHaveCount(1);
  expect(server.calls).toBe(1);
});

test('revoked session sends the user to login with a notice', async ({ page }) => {
  await signIn(page, 'tourist');
  await fixtures(page);
  await page.route('**/api/auth/sessions', (route) =>
    json(route, { code: 'session_revoked', error: 'Phiên đăng nhập đã kết thúc' }, 401),
  );
  await page.route('**/api/auth/refresh', (route) =>
    json(route, { code: 'session_revoked', error: 'Phiên đăng nhập đã kết thúc' }, 401),
  );
  await page.goto('/account/devices');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fdevices/);
  await expect(page.getByText('Phiên đăng nhập đã kết thúc trên thiết bị này')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('geosound:auth'))).toBeNull();
});

test('logout calls the server with the current token', async ({ page }) => {
  await signIn(page, 'tourist');
  await fixtures(page);
  let logoutAuth = null;
  await page.route('**/api/auth/logout', (route) => {
    logoutAuth = route.request().headers().authorization;
    return route.fulfill({ status: 204 });
  });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => logoutAuth).toBe('Bearer test-access');
  expect(await page.evaluate(() => localStorage.getItem('geosound:auth'))).toBeNull();
});
