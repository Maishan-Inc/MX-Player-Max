import { expect, test, type Page } from '@playwright/test'

test('renders real VP8 WASM frames on a non-isolated single-thread path', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop' && testInfo.project.name !== 'firefox-simulated')
  const diagnostics = collectDiagnostics(page)
  await page.goto('/?wasmAcceptance=single', { waitUntil: 'domcontentloaded' })
  const status = await waitForAcceptanceStatus(page)
  const result = await page.evaluate(() => (window as typeof window & { __wasmAcceptance?: AcceptanceResult }).__wasmAcceptance)
  expect(status, diagnostics.describe(result)).toBe('passed')
  expect(result).toMatchObject({
    status: 'passed', isolated: false, selectedBackend: 'wasm', errorCode: null,
    attempts: [
      { candidateId: 'webcodecs-custom', status: 'failed' },
      { candidateId: 'wasm-custom', status: 'selected' },
    ],
  })
  expect(result?.nonEmptyPixels ?? 0).toBeGreaterThan(0)
  expect(result?.epoch ?? 0).toBeGreaterThanOrEqual(2)
  expect(result?.queuedFrames ?? 99).toBeLessThanOrEqual(4)
  expect(result?.decodeQueueSize ?? 99).toBeLessThanOrEqual(4)
  expect(diagnostics.wasmRequests.some((url) => url.endsWith('/libvpx-vp8-single.wasm'))).toBe(true)
  expect(diagnostics.wasmRequests.some((url) => url.includes('threaded'))).toBe(false)
})

test('falls back from threaded initialization to SIMD without interrupting playback', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop')
  const diagnostics = collectDiagnostics(page)
  await page.goto('/?wasmAcceptance=isolated', { waitUntil: 'domcontentloaded' })
  const status = await waitForAcceptanceStatus(page)
  const result = await page.evaluate(() => (window as typeof window & { __wasmAcceptance?: AcceptanceResult }).__wasmAcceptance)
  expect(status, diagnostics.describe(result)).toBe('passed')
  expect(result).toMatchObject({ status: 'passed', isolated: true, selectedBackend: 'wasm', errorCode: null })
  expect(result?.nonEmptyPixels ?? 0).toBeGreaterThan(0)
  const wasmAssets = diagnostics.wasmRequests.filter((url) => url.endsWith('.wasm')).map((url) => url.split('/').at(-1))
  expect(wasmAssets).toEqual(['libvpx-vp8-threaded.wasm', 'libvpx-vp8-simd.wasm'])
})

async function waitForAcceptanceStatus(page: Page): Promise<string | null> {
  await expect.poll(async () => {
    const status = await page.locator('body').getAttribute('data-status')
    return status === 'passed' || status === 'failed'
  }, { timeout: 45_000 }).toBe(true)
  return page.locator('body').getAttribute('data-status')
}

function collectDiagnostics(page: Page): AcceptanceDiagnostics {
  const consoleMessages: string[] = []
  const failedRequests: string[] = []
  const pageErrors: string[] = []
  const wasmRequests: string[] = []
  const wasmResponses: string[] = []
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => { if (request.url().includes('/wasm/')) wasmRequests.push(request.url()) })
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? 'unknown'}`))
  page.on('response', (response) => {
    if (response.url().includes('/wasm/')) wasmResponses.push(`${response.status()} ${response.url()}`)
  })
  return {
    wasmRequests,
    describe: (result) => JSON.stringify({ result, consoleMessages, pageErrors, failedRequests, wasmRequests, wasmResponses }, null, 2),
  }
}

interface AcceptanceResult {
  readonly status: 'passed' | 'failed'
  readonly isolated: boolean
  readonly selectedBackend: string | null
  readonly attempts: readonly { candidateId: string; kind: string; status: string; errorCode: string | null }[]
  readonly nonEmptyPixels: number
  readonly epoch: number
  readonly queuedFrames: number
  readonly decodeQueueSize: number
  readonly errorCode: string | null
  readonly errorDetail?: string
  readonly decodedFrames?: number
  readonly deliveredFrames?: number
  readonly droppedFrames?: number
  readonly droppedStaleFrames?: number
  readonly clockMediaTime?: number
  readonly clockEpoch?: number
}

interface AcceptanceDiagnostics {
  readonly wasmRequests: string[]
  describe(result: AcceptanceResult | undefined): string
}
