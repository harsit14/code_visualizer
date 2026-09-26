import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the production build served by `vite preview`, which
 * sends the same COOP/COEP headers as the Worker. There is no /api here, so the
 * app runs with the static-host capabilities.
 */
const PORT = 4178;
const baseURL = `http://127.0.0.1:${PORT}`;
const ci = Boolean(process.env.CI);
// CI builds in its own step; locally, E2E_SKIP_BUILD=1 reuses an existing dist.
const skipBuild = process.env.E2E_SKIP_BUILD === '1';
const MOBILE_VIEWPORT = { width: 390, height: 844 };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  // A cold Pyodide start compiles a large WebAssembly module before the first run.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: ci
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `${skipBuild ? '' : 'npm run build && '}npm run preview -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !ci,
    timeout: 300_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
    // Phones get the tabbed workspace, so only the mobile and landing specs apply.
    {
      name: 'mobile-chromium',
      testMatch: /(mobile|landing)\.spec\.ts/,
      use: { ...devices['Pixel 7'], viewport: MOBILE_VIEWPORT },
    },
    {
      name: 'mobile-webkit',
      testMatch: /(mobile|landing)\.spec\.ts/,
      use: { ...devices['iPhone 13'], viewport: MOBILE_VIEWPORT },
    },
  ],
});
