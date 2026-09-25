import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4189', trace: 'retain-on-failure' },
  projects: [
    { name: 'chrome-stable', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'edge-stable', use: { browserName: 'chromium', channel: 'msedge' } },
    { name: 'firefox-automation', use: { browserName: 'firefox' } },
    { name: 'webkit-automation', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'pnpm --dir apps/demo exec vite --config vite.vp9-acceptance.config.ts --host 127.0.0.1 --port 4189 --strictPort',
    cwd: resolve(__dirname, '../../..'),
    url: 'http://127.0.0.1:4189',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
