import { test, expect } from '@playwright/test';

// #263 — browser voice on Android Chrome: speechSynthesis.pause() ends the utterance there, so the
// player must not run the desktop pause/resume keep-alive, and pause/resume must restart from the
// last word. A fake speechSynthesis records every call.

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

async function fakeSpeech(page) {
  await page.addInitScript(() => {
    window.__speech = { spoken: [], pauses: 0, resumes: 0, cancels: 0 };
    window.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text; this.lang = ''; this.voice = null; }
    };
    const synth = {
      speaking: false, paused: false, pending: false,
      getVoices: () => [{ lang: 'en-US', name: 'English' }, { lang: 'vi-VN', name: 'Tiếng Việt' }],
      speak(u) {
        window.__speech.spoken.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name });
        window.__lastUtterance = u;
        this.speaking = true;
      },
      cancel() { window.__speech.cancels += 1; this.speaking = false; this.paused = false; },
      pause() { window.__speech.pauses += 1; this.paused = true; },
      resume() { window.__speech.resumes += 1; this.paused = false; },
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  });
}

const TEXT = 'Xin chào Hội An';

test.describe('Android Chrome', () => {
  test.use({ userAgent: ANDROID_UA });

  test('no pause/resume keep-alive, vi-VN with a Vietnamese voice', async ({ page }) => {
    await fakeSpeech(page);
    await page.goto('/test/ui/audio-harness.html');
    await page.waitForFunction(() => window.controller);
    await page.evaluate((text) => window.controller.playTrack({ id: 'p1', text, lang: 'vi' }), TEXT);
    await page.waitForTimeout(2500);
    const s = await page.evaluate(() => window.__speech);
    expect(s.pauses).toBe(0);
    expect(s.spoken).toEqual([{ text: TEXT, lang: 'vi-VN', voice: 'Tiếng Việt' }]);
    expect(await page.evaluate(() => window.controller.state.status)).toBe('playing');
  });

  test('pause cancels, resume speaks the rest once (toggle under StrictMode-safe path)', async ({ page }) => {
    await fakeSpeech(page);
    await page.goto('/test/ui/audio-harness.html');
    await page.waitForFunction(() => window.controller);
    await page.evaluate((text) => window.controller.playTrack({ id: 'p1', text, lang: 'vi' }), TEXT);
    await page.evaluate(() => window.__lastUtterance.onboundary({ charIndex: 4 }));

    await page.evaluate(() => window.controller.toggle());
    await expect.poll(() => page.evaluate(() => window.controller.state.status)).toBe('paused');
    expect(await page.evaluate(() => window.__speech.pauses)).toBe(0);

    await page.evaluate(() => window.controller.toggle());
    await expect.poll(() => page.evaluate(() => window.controller.state.status)).toBe('playing');
    const s = await page.evaluate(() => window.__speech);
    expect(s.spoken.map((x) => x.text)).toEqual([TEXT, 'chào Hội An']);
    expect(s.resumes).toBe(0);
  });

  test('a speech error sets the error state with its code', async ({ page }) => {
    await fakeSpeech(page);
    await page.goto('/test/ui/audio-harness.html');
    await page.waitForFunction(() => window.controller);
    await page.evaluate((text) => window.controller.playTrack({ id: 'p1', text, lang: 'vi' }), TEXT);
    await page.evaluate(() => window.__lastUtterance.onerror({ error: 'language-unavailable' }));
    await expect.poll(() => page.evaluate(() => window.controller.state.status)).toBe('error');
    expect(await page.evaluate(() => window.controller.state.ttsError)).toBe('language-unavailable');
  });
});

test('desktop keeps the pause/resume keep-alive for long texts', async ({ page }) => {
  await fakeSpeech(page);
  await page.goto('/test/ui/audio-harness.html');
  await page.waitForFunction(() => window.controller);
  await page.evaluate((text) => window.controller.playTrack({ id: 'p1', text, lang: 'vi' }), TEXT);
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => window.__speech);
  expect(s.pauses).toBeGreaterThan(0);
  expect(s.resumes).toBeGreaterThan(0);
});

test('quick preview speaks at once (inside the tap) with vi-VN when nothing is playing', async ({ page }) => {
  await fakeSpeech(page);
  await page.goto('/test/ui/audio-harness.html');
  await page.waitForFunction(() => window.controller);
  const spoken = await page.evaluate(async (text) => {
    const { playPreview } = await import('/src/lib/preview-audio.js');
    playPreview({ text, lang: 'vi' });
    return window.__speech.spoken; // read synchronously after the call: no setTimeout
  }, TEXT);
  expect(spoken).toEqual([{ text: TEXT, lang: 'vi-VN', voice: 'Tiếng Việt' }]);
});

test('local gateway media URLs become same-origin paths', async ({ page }) => {
  await page.goto('/test/ui/audio-harness.html');
  const out = await page.evaluate(async () => {
    const { localizeUrls, localizeUrl } = await import('/src/lib/media-url.js');
    return {
      deep: localizeUrls({
        audioUrl: 'http://localhost:8080/api/media/files/audios/a.webm',
        images: [{ url: 'http://127.0.0.1:8080/api/media/files/images/b.jpg' }, { url: 'https://picsum.photos/x.jpg' }],
        other: 'http://localhost:5173/login',
        n: 3,
        none: null,
      }),
      withBase: localizeUrl('http://localhost:8080/api/media/files/c.png', 'https://api.example.com'),
    };
  });
  expect(out.deep).toEqual({
    audioUrl: '/api/media/files/audios/a.webm',
    images: [{ url: '/api/media/files/images/b.jpg' }, { url: 'https://picsum.photos/x.jpg' }],
    other: 'http://localhost:5173/login',
    n: 3,
    none: null,
  });
  expect(out.withBase).toBe('https://api.example.com/api/media/files/c.png');
});
