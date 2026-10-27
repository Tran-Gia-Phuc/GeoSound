import { test, expect } from '@playwright/test';
import { id, secondId, places, tour, json, fixtures } from './fixtures.js';

test('first gesture and late unlock do not reset a selected track', async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    let delayed = false;
    HTMLMediaElement.prototype.play = function (...args) {
      if (!delayed && !this.getAttribute('src')) {
        delayed = true;
        return new Promise((resolve) => { window.resolvePendingUnlock = resolve; });
      }
      return play.apply(this, args);
    };
  });
  const samples = 8000 * 90;
  const body = Buffer.alloc(44 + samples * 2);
  body.write('RIFF', 0);body.writeUInt32LE(body.length - 8, 4);body.write('WAVEfmt ', 8);
  body.writeUInt32LE(16, 16);body.writeUInt16LE(1, 20);body.writeUInt16LE(1, 22);
  body.writeUInt32LE(8000, 24);body.writeUInt32LE(16000, 28);body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34);body.write('data', 36);body.writeUInt32LE(samples * 2, 40);
  await page.route('**/seek.wav', r => {
    const range = r.request().headers().range;
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!match) return r.fulfill({contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'},body});
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
    return r.fulfill({status:206,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${body.length}`},body:body.subarray(start,end+1)});
  });
  await page.route('**/api/tours/' + id, r => json(r, { tour:{...tour,places:places.map(item=>({...item,audioUrl:'http://127.0.0.1:5180/seek.wav',audioSource:'human'}))}}));
  await page.goto('/tour/' + id + '/play?mode=remote&stop=' + secondId);
  const slider=page.getByRole('slider',{name:'Tua audio',exact:true});
  await expect(slider).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.resolvePendingUnlock)).toBe('function');
  await page.getByRole('button',{name:/Tua tới (10|15) giây/}).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThanOrEqual(9.5);
  await page.evaluate(() => window.resolvePendingUnlock());
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThanOrEqual(9.5);
  await expect(page.locator('.sheet__title')).toHaveText(places[0].name);
});
