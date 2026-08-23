import { defineConfig } from '@playwright/test'

const concurrentProjectNames = [
  'chromium-desktop',
  'chromium-mobile',
  'firefox-simulated',
  'webkit-simulated',
  'media-chromium',
  'media-firefox',
  'media-webkit-automation',
] as const

export default defineConfig({
  testDir: '.',
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
    { name: 'chromium-desktop', testDir: './packages/ui/tests/playwright', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-mobile', testDir: './packages/ui/tests/playwright', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'firefox-simulated', testDir: './packages/ui/tests/playwright', use: { browserName: 'firefox', viewport: { width: 1280, height: 800 } } },
    { name: 'webkit-simulated', testDir: './packages/ui/tests/playwright', use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } },
    { name: 'media-chromium', testDir: './tests/browser/media', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    // Firefox runs the custom path roughly 60% slower than Chromium; a scripted acceptance that
    // plays, seeks and replays a 3 s sample lands within a second or two of the 45 s default
    // there, so it needs the same headroom as the WebKit automation project.
    { name: 'media-firefox', testDir: './tests/browser/media', timeout: 120_000, use: { browserName: 'firefox', viewport: { width: 1280, height: 800 } } },
    { name: 'media-webkit-automation', testDir: './tests/browser/media', timeout: 120_000, use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } },
    { name: 'performance-chromium', dependencies: [...concurrentProjectNames], testDir: './tests/browser/performance', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'performance-firefox', dependencies: ['performance-chromium'], testDir: './tests/browser/performance', use: { browserName: 'firefox', viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'pnpm --dir apps/demo exec vite preview --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
