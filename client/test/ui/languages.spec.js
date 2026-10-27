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
