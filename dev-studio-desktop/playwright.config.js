const { defineConfig, devices } = require('@playwright/test');

/**
 * Real-browser (Chromium/Chrome) end-to-end tests.
 *
 * Runs against the production build served by `vite preview`.
 * Locally:  npm run build && npm run test:e2e   (first: npx playwright install chromium)
 * In CI:    the e2e-chrome job installs Chromium and runs this on every push.
 */
module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 60_000
  }
});
