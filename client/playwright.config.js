import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/ui',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'node_modules/.playwright-results',
  use: {
    baseURL: process.env.UI_BASE_URL || 'http://127.0.0.1:5180',
    browserName: 'chromium',
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: false,
    timeout: 30000,
    env: { VITE_PROXY_TARGET: process.env.API_TARGET || 'http://127.0.0.1:8080' },
  },
});
