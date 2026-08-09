import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './packages/ui/tests/playwright',
  timeout: 45_000,
  expect: { timeout: 8_000, toHaveScreenshot: { maxDiffPixelRatio: 0.012 } },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'firefox-simulated', use: { browserName: 'firefox', viewport: { width: 1280, height: 800 } } },
    { name: 'webkit-simulated', use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'pnpm --dir apps/demo exec vite preview --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
