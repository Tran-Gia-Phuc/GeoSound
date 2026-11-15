import { test, expect } from '@playwright/test';
import {
  id,
  secondId,
  userId,
  places,
  tour,
  itinerary,
  library,
  languages,
  json,
  signIn,
  fixtures,
  noOverflow,
  liveRead,
} from './fixtures.js';

test('full creation form previews and saves to selected destination', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  let payload;
  await page.route('**/api/tours', (r) => {
    payload = r.request().postDataJSON();
    return json(r, { tour }, 201);
  });
  await page.goto('/studio/tours/new');
  await page.getByLabel('Tên tour *', { exact: true }).fill('Tour thử từ UI');
  await page.getByLabel('Mô tả', { exact: true }).fill('Nội dung bản nháp');
  await expect(page.getByRole('complementary', { name: 'Xem trước bản nháp' })).toContainText(
    'Tour thử từ UI',
  );
  await page.getByRole('button', { name: 'Lưu nháp & thoát', exact: true }).click();
  await expect(page).toHaveURL(/studio$/);
  expect(payload.title).toBe('Tour thử từ UI');
  expect(payload.description).toBe('Nội dung bản nháp');
  expect(payload.status).toBeUndefined();
});
test('creation failure preserves fields and never navigates', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  await page.route('**/api/tours', (r) => json(r, { error: 'Create unavailable' }, 503));
  await page.goto('/studio/tours/new');
  await page.getByLabel('Tên tour *', { exact: true }).fill('Bản nháp cần giữ');
  await page.getByRole('button', { name: 'Tạo & thêm điểm dừng', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Create unavailable');
  await expect(page.getByLabel('Tên tour *', { exact: true })).toHaveValue('Bản nháp cần giữ');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});
