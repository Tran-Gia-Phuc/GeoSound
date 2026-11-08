// UC01 / UC23 R6: change password screen (/account/password); the Auth API is mocked.
import { test, expect } from '@playwright/test';
import { json, signIn, fixtures, noOverflow } from './fixtures.js';

async function mockChange(page, reply) {
  const calls = [];
  await fixtures(page);
  await page.route('**/api/auth/change-password', async (route) => {
    calls.push(route.request().postDataJSON());
    return reply(route);
  });
  return calls;
}

async function fill(page, { current = 'oldpass1', next = 'newpass22', confirm = next } = {}) {
  await page.getByLabel('Mật khẩu hiện tại').fill(current);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill(next);
  await page.getByLabel('Nhập lại mật khẩu mới').fill(confirm);
}

test('account menu opens the screen; success signs out other devices and goes back', async ({ page }) => {
  const calls = await mockChange(page, (route) => json(route, { message: 'Đổi mật khẩu thành công', revoked: 2 }));
  await signIn(page, 'tourist');
  await page.goto('/account');
  await page.getByRole('link', { name: 'Đổi mật khẩu' }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  await fill(page);
  await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await expect(page.getByText('Đã đổi mật khẩu. Đã đăng xuất 2 thiết bị khác.')).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  expect(calls).toEqual([{ currentPassword: 'oldpass1', newPassword: 'newpass22' }]);
});

test('client checks: empty, weak, same as current, confirmation mismatch; nothing is sent', async ({ page }) => {
  const calls = await mockChange(page, (route) => json(route, { revoked: 0 }));
  await signIn(page, 'tourist');
  await page.goto('/account/password');
  const submit = page.getByRole('button', { name: 'Đổi mật khẩu' });

  await submit.click();
  await expect(page.getByText('Vui lòng nhập mật khẩu hiện tại')).toBeVisible();
  await expect(page.getByText('Vui lòng nhập mật khẩu mới')).toBeVisible();

  await fill(page, { next: 'short1' });
  await submit.click();
  await expect(page.getByText('Mật khẩu phải có tối thiểu 8 ký tự')).toBeVisible();

  await fill(page, { next: 'onlyletters' });
  await submit.click();
  await expect(page.getByText('Mật khẩu phải gồm cả chữ và số')).toBeVisible();

  await fill(page, { current: 'samepass1', next: 'samepass1' });
  await submit.click();
  await expect(page.getByText('Mật khẩu mới phải khác mật khẩu hiện tại')).toBeVisible();

  await fill(page, { next: 'newpass22', confirm: 'newpass23' });
  await submit.click();
  await expect(page.getByText('Mật khẩu nhập lại không khớp')).toBeVisible();
  expect(calls).toHaveLength(0);
});

test('wrong current password shows the server message on that field', async ({ page }) => {
  await mockChange(page, (route) =>
    json(route, { error: 'Mật khẩu hiện tại không đúng', code: 'wrong_password' }, 400),
  );
  await signIn(page, 'tourist');
  await page.goto('/account/password');
  await fill(page);
  await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await expect(page.locator('#cp-current-err')).toHaveText('Mật khẩu hiện tại không đúng');
  await expect(page).toHaveURL(/\/account\/password$/);
});

test('network failure shows the offline message', async ({ page }) => {
  await mockChange(page, (route) => route.abort('internetdisconnected'));
  await signIn(page, 'tourist');
  await page.goto('/account/password');
  await fill(page);
  await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Không thể kết nối, vui lòng thử lại' })).toBeVisible();
});

test('signed out: the screen asks to sign in; phone width has no horizontal scroll', async ({ page }) => {
  await fixtures(page);
  await page.goto('/account/password');
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, 'tourist');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account/password');
  await expect(page.getByRole('heading', { name: 'Đổi mật khẩu' })).toBeVisible();
  await noOverflow(page);
});
