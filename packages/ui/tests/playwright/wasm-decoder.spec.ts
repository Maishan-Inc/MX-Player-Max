import { expect, test, type Page } from '@playwright/test'
// The probes live with the media acceptance cases because that is where they are centralised; these
// two cases need the same question asked of the browser, so they ask it there rather than again here.
import { hasWebCodecs } from '../../../../tests/browser/media/capabilities'

/**
 * Both cases drive the real libvpx WASM decoder, and both need the browser to have WebCodecs -- not
 * to decode with it, but because of what the fallback is made of. `VideoFrame` is how libvpx's
 * planes leave linear memory, and `VideoDecoder` has to exist for the acceptance harness to hand the
 * strategy engine a WebCodecs candidate that fails, which is the premise of the atomic fallback.
 *
 * They used to skip on `testInfo.project.name` instead: the first ran only in `chromium-desktop` and
 * `firefox-simulated`, the second only in `chromium-desktop`. That is a guess about browsers wearing
 * the shape of a decision, and the guess was wrong in both directions. Measured with the guard
 * removed, the first also passes in `chromium-mobile` and the second also passes in
 * `chromium-mobile` and `firefox-simulated`, so three project-case pairs were being withheld for no
 * reason; and both fail in `webkit-simulated`, which the name list happened to exclude but says
 * nothing about. Playwright's WebKit has no `VideoFrame`, and the isolated case shows what that
 * costs: it selects the WASM backend, fetches the threaded variant and then the SIMD one, and ends
 * in `WASM_ACCEPTANCE_CANVAS_BLANK` with nothing ever drawn.
 *
 * `crossOriginIsolated` is deliberately not probed. The isolated case needs it, but it is set by the
 * demo server's COOP/COEP headers rather than by the browser, so a probe would convert a regression
 * in those headers into a skip. WebKit reaches the threaded variant and then the SIMD one here, so
 * every browser in this matrix satisfies the threading prerequisites; a browser that does not would
 * fail this case loudly, which is the outcome worth having until someone can measure one.
 */
test('renders real VP8 WASM frames on a non-isolated single-thread path', async ({ page }) => {
  test.skip(!await hasWebCodecs(page), `WebCodecs unavailable in ${test.info().project.name}`)
  const diagnostics = collectDiagnostics(page)
  await page.goto('/?wasmAcceptance=single', { waitUntil: 'domcontentloaded' })
  const status = await waitForAcceptanceStatus(page)
  const result = await page.evaluate(() => (window as typeof window & { __wasmAcceptance?: AcceptanceResult }).__wasmAcceptance)
  expect(status, diagnostics.describe(result)).toBe('passed')
  expect(result).toMatchObject({ status: 'passed', isolated: false, selectedBackend: 'wasm', errorCode: null })
  // Matched by content, not by position: the trace also records strategy exclusions as skipped
  // attempts indexed past the ranked candidates, so a new exclusion must not shift this.
  expect(result?.attempts).toEqual(expect.arrayContaining([
    expect.objectContaining({ candidateId: 'webcodecs-custom', status: 'failed' }),
    expect.objectContaining({ candidateId: 'wasm-custom', status: 'selected' }),
  ]))
  expect(result?.nonEmptyPixels ?? 0).toBeGreaterThan(0)
  expect(result?.epoch ?? 0).toBeGreaterThanOrEqual(2)
  expect(result?.queuedFrames ?? 99).toBeLessThanOrEqual(4)
  expect(result?.decodeQueueSize ?? 99).toBeLessThanOrEqual(4)
  expect(diagnostics.wasmRequests.some((url) => url.endsWith('/libvpx-vp8-single.wasm'))).toBe(true)
  expect(diagnostics.wasmRequests.some((url) => url.includes('threaded'))).toBe(false)
})

test('falls back from threaded initialization to SIMD without interrupting playback', async ({ page }) => {
  test.skip(!await hasWebCodecs(page), `WebCodecs unavailable in ${test.info().project.name}`)
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
