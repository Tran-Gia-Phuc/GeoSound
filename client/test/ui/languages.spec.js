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

test('placeholder is not shown as generated offline audio', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  await page.goto('/studio/tours/' + id + '/languages');
  await expect(
    page.getByText('Nghe thử bằng giọng trên thiết bị · chưa có tệp âm thanh'),
  ).toHaveCount(2);
  await page.locator('.tx-row__text').first().fill('Unsaved translation');
  await expect(
    page.locator('.tx-row').first().getByRole('button', { name: 'Nghe thử', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.tx-row__text').first()).toHaveValue('Unsaved translation');
});
test('preview endpoint error does not discard translations', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  await page.route('**/tts-preview', (r) => json(r, { error: 'Preview unavailable' }, 503));
  await page.goto('/studio/tours/' + id + '/languages');
  await page
    .locator('.tx-row')
    .first()
    .getByRole('button', { name: 'Nghe thử', exact: true })
    .click();
  await expect(page.locator('.tx-row').first()).toContainText('Preview unavailable');
  await expect(page.locator('.tx-row__text').first()).toHaveValue('Translated stop content.');
});
test('unavailable speech is recoverable and cancels on unmount', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }),
  );
  await fixtures(page);
  await signIn(page);
  await page.route('**/tts-preview', (r) =>
    json(r, { url: 'tts://en/preview', prerendered: false }),
  );
  await page.goto('/studio/tours/' + id + '/languages');
  await page
    .locator('.tx-row')
    .first()
    .getByRole('button', { name: 'Nghe thử', exact: true })
    .click();
  await expect(page.locator('.tx-row').first()).toContainText('Không phát được bản nghe thử');
  await expect(
    page.locator('.tx-row').first().getByRole('button', { name: 'Nghe thử', exact: true }),
  ).toBeEnabled();
});

test('out-of-order previews keep the current row busy and discard stale errors', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  const pending = [];
  await page.route('**/tts-preview', async (route) => {
    await new Promise((resolve) => pending.push({ route, resolve }));
  });
  await page.goto('/studio/tours/' + id + '/languages');
  const rows = page.locator('.tx-row');
  const first = rows.first().getByRole('button', { name: 'Nghe thử', exact: true });
  const second = rows.nth(1).getByRole('button', { name: 'Nghe thử', exact: true });
  await first.click();
  await expect.poll(() => pending.length).toBe(1);
  await second.click();
  await expect.poll(() => pending.length).toBe(2);
  await expect(first).toBeEnabled();
  await first.click();
  await expect.poll(() => pending.length).toBe(3);
  await json(pending[0].route, { error: 'Stale error' }, 503);
  pending[0].resolve();
  await expect(first).toBeDisabled();
  await expect(rows.first()).not.toContainText('Stale error');
  await expect(second).toBeEnabled();
  await json(pending[1].route, { error: 'Other stale error' }, 503);
  pending[1].resolve();
  await expect(first).toBeDisabled();
  await json(pending[2].route, { error: 'Current error' }, 503);
  pending[2].resolve();
  await expect(rows.first()).toContainText('Current error');
  await expect(first).toBeEnabled();
  await expect(rows.first().locator('textarea')).toHaveValue('Translated stop content.');
});
test('edited translation made from an older description is flagged for review', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  const config = structuredClone(languages);
  config.languages[1].outdated = 1;
  config.places[0].translations[1].outdated = true;
  await page.route('**/api/tours/mine/*/languages', (r) => json(r, { config }));
  await page.goto('/studio/tours/' + id + '/languages');
  await expect(page.getByText('1 bản chỉnh tay cần xem lại (mô tả gốc đã đổi)', { exact: false })).toBeVisible();
  await expect(page.locator('.tx-row').first().locator('.chip')).toHaveText('Cần xem lại');
  await expect(page.locator('.tx-row').nth(1).locator('.chip')).toHaveText('Đã sửa');
});
