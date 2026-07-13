import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  timeout: 40_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://127.0.0.1:19006',
    ...devices['Pixel 5'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
