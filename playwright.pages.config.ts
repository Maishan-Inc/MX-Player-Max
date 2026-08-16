import { defineConfig } from '@playwright/test'

const pagesBaseUrl = 'http://127.0.0.1:4178/MX-Player-Max/'

export default defineConfig({
  testDir: './tests/browser/pages',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: pagesBaseUrl,
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'pages-chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'pnpm --dir apps/demo exec vite preview --host 127.0.0.1 --port 4178 --strictPort --base /MX-Player-Max/',
    url: pagesBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
