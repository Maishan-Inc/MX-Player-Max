import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 6 chose the pipeline only at load time: turning a filter on, or leaving the custom path,
 * meant the host called `load()` again and the viewer lost their position and their sidecar subtitle
 * tracks. This drives one real switch through the built assets and asserts what has to survive it.
 *
 * The sample is video-only on purpose. The custom pipeline gates its video pump on the audio clock,
 * so on a machine with no audio output device -- headless Firefox here -- a sample with sound can
 * never reach `playing`, and the case would be unrunnable in the environment that most needs it.
 */
test.describe('runtime render-mode switching', () => {
  test('moves a playing Native session onto the custom pipeline without reloading', async ({ page }) => {
    const result = await runSwitch(page)
    test.skip(result.status === 'unsupported', `Custom pipeline unavailable in ${test.info().project.name}: ${result.errorCode}`)
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
