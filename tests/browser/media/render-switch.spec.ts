import { expect, test, type Page } from '@playwright/test'
import { decodesWithWebCodecs, playsNatively } from './capabilities'

/** The one sample this case drives, on both sides of the switch. */
const SAMPLE = 'webm-vp8-p0-8bit-video-only.webm'

/**
 * Phase 6 chose the pipeline only at load time: turning a filter on, or leaving the custom path,
 * meant the host called `load()` again and the viewer lost their position and their sidecar subtitle
 * tracks. This drives one real switch through the built assets and asserts what has to survive it.
 *
 * The sample is video-only on purpose. The custom pipeline gates its video pump on the audio clock,
 * so a sample with sound makes the case depend on the box being able to render audio at all, and it
 * is the environments least able to do that which most need this coverage.
 */
test.describe('runtime render-mode switching', () => {
  test('moves a playing Native session onto the custom pipeline without reloading', async ({ page }) => {
    /**
     * Both sides of the switch need their own capability, and the case skips on the browser rather
     * than on the acceptance result: a browser with neither route reports the same
     * `STRATEGY_ALL_CANDIDATES_FAILED` that a broken switch would, so forgiving that code would let
     * a regression skip instead of turning red. Playwright WebKit is the case in point -- it plays
     * no WebM at all and ships no `VideoDecoder`.
     */
    test.skip(!await playsNatively(page, SAMPLE), `Native VP8 unavailable in ${test.info().project.name}`)
    test.skip(!await decodesWithWebCodecs(page, { video: 'vp8' }), `WebCodecs VP8 unavailable in ${test.info().project.name}`)
    const result = await runSwitch(page)
    expect(result).toMatchObject({ status: 'passed', errorCode: null })

    // The switch itself: the renderer changes and so does the surface behind it.
    expect(result.beforeBackend).toBe('html-video')
    expect(result.beforeRenderer).toBeNull()
    expect(result.beforeSurface).toBe('video')
    expect(result.afterBackend).toBe('webcodecs')
    expect(result.afterRenderer).toBe('canvas2d')
    expect(result.afterSurface).toBe('canvas')

    // A rebuild is a new session for every epoch-keyed consumer, so the epoch has to move forward.
    expect(result.afterEpoch).toBeGreaterThan(result.beforeEpoch)
    // Position continuity: the new pipeline resumes where the old one was, never behind it.
    expect(result.beforeTime).toBeGreaterThanOrEqual(500_000)
    expect(result.afterTime).toBeGreaterThanOrEqual(result.beforeTime)
    // It was playing before the switch, so it is playing after it.
    expect(result.afterState).toBe('playing')
    // The canvas is actually being drawn to, not merely attached.
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
    // The sidecar track the host added survives the rebuild and stays selected.
    expect(result.subtitleTrackIds.length).toBeGreaterThan(0)
    expect(result.selectedSubtitleTrackId).not.toBeNull()
  })
})

async function runSwitch(page: Page): Promise<RenderSwitchResult> {
  await page.goto('/?renderSwitch=native-to-custom', { waitUntil: 'domcontentloaded' })
  await page.locator('#switch-start').click({ noWaitAfter: true })
  await page.waitForFunction(() => /^(passed|failed|unsupported)$/.test(document.body.dataset.status ?? ''), undefined, { timeout: 120_000 })
  const result = await page.evaluate(() => (window as typeof window & { __renderSwitch?: RenderSwitchResult }).__renderSwitch)
  if (result === undefined) throw new Error('Render switch acceptance did not publish a result')
  return result
}

interface RenderSwitchResult {
  readonly status: 'passed' | 'failed' | 'unsupported'
  readonly beforeBackend: string | null
  readonly beforeRenderer: string | null
  readonly afterBackend: string | null
  readonly afterRenderer: string | null
  readonly beforeSurface: 'video' | 'canvas' | null
  readonly afterSurface: 'video' | 'canvas' | null
  readonly beforeEpoch: number
  readonly afterEpoch: number
  readonly beforeTime: number
  readonly afterTime: number
  readonly afterState: string | null
  readonly nonEmptyPixels: number
  readonly subtitleTrackIds: readonly string[]
  readonly selectedSubtitleTrackId: string | null
  readonly errorCode: string | null
}
