import { test, expect } from '@playwright/test';

test('retry restores the same seekable track and ignores obsolete failures', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeAudio extends EventTarget {
      constructor() { super(); window.fakeAudio = this; this.currentTime = 0; this.duration = 600; this.seekable = { length: 1, start: () => 0, end: () => 600 }; this.requests = []; }
      set src(value) { this._src = value; this.currentTime = 0; this.requests.push(value); }
      get src() { return this._src; }
      play() { return Promise.resolve(); }
      pause() {}
      removeAttribute() {}
    }
    window.Audio = FakeAudio;
  });
  await page.goto('/test/ui/audio-harness.html');
  await page.waitForFunction(() => window.controller);
  await page.evaluate(() => window.controller.playTrack({ id: 'one', src: '/one.mp3' }));
  await page.evaluate(() => { fakeAudio.currentTime = 320; fakeAudio.dispatchEvent(new Event('timeupdate')); fakeAudio.onerror(); });
  await expect.poll(() => page.evaluate(() => window.controller.state.status)).toBe('error');
  await page.evaluate(() => { controller.retry(); fakeAudio.onloadedmetadata(); });
  expect(await page.evaluate(() => fakeAudio.currentTime)).toBe(320);
  await page.evaluate(() => { fakeAudio.onerror(); controller.retry(); controller.retry(); });
  expect(await page.evaluate(() => fakeAudio.requests.length)).toBe(3);
  await page.evaluate(() => { const oldFailure = fakeAudio.onerror; controller.playTrack({ id: 'two', src: '/two.mp3' }); oldFailure(); fakeAudio.onloadedmetadata(); });
  expect(await page.evaluate(() => fakeAudio.currentTime)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.controller.state.trackId)).toBe('two');
  expect(await page.evaluate(() => fakeAudio.src)).toBe('/two.mp3');
});

test('retry of an unseekable source does not throw', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeAudio extends EventTarget {
      constructor() { super(); window.fakeAudio = this; this.currentTime = 0; this.duration = Infinity; this.seekable = { length: 0 }; }
      set src(value) { this.currentTime = 0; }
      play() { return Promise.resolve(); }
      pause() {}
      removeAttribute() {}
    }
    window.Audio = FakeAudio;
  });
  await page.goto('/test/ui/audio-harness.html');
  await page.waitForFunction(() => window.controller);
  await page.evaluate(() => { controller.playTrack({ id: 'one', src: '/one.mp3' }); fakeAudio.currentTime = 20; fakeAudio.dispatchEvent(new Event('timeupdate')); fakeAudio.onerror(); controller.retry(); fakeAudio.onloadedmetadata(); });
  expect(await page.evaluate(() => fakeAudio.currentTime)).toBe(0);
});
