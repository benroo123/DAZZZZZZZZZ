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
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'backend-contracts',
      testMatch: /(?:api-parity|async-publication)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'compact-android',
      testMatch: /mobile-ui\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 320, height: 640 },
      },
    },
    {
      name: 'standard-iphone-viewport',
      testMatch: /mobile-ui\.spec\.ts/,
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
    {
      name: 'large-android',
      testMatch: /mobile-ui\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
});
