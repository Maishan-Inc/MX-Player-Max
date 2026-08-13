import { expect, test, type Page } from '@playwright/test'

for (const isolated of [false, true]) {
  test(`collects a native performance smoke (${isolated ? 'isolated' : 'non-isolated'})`, async ({ page }) => {
    const result = await collect(page, isolated)
    expect(result).toMatchObject({ schemaVersion: 1, status: 'passed', evidenceLevel: 'playwright-automation', scenario: 'smoke', backend: 'html-video', errorCode: null })
    expect(result.environment.crossOriginIsolated).toBe(isolated)
    expect(result.sample.sha256).toBe('e9e8baf10f81588a257bffe147648c31f5a0c5e5a52b57888e935917749d13b8')
    expect(result.metrics.firstFrameMs.value).toBeGreaterThan(0)
    expect(result.metrics.firstFrameMs.value ?? Infinity).toBeLessThanOrEqual(2_000)
    expect(result.metrics.firstSubtitleMs.value ?? Infinity).toBeLessThanOrEqual(2_500)
    expect(result.metrics.seekLatencyMs.value ?? Infinity).toBeLessThanOrEqual(1_000)
    expect(result.metrics.bufferedAheadMicros.value ?? 0).toBeGreaterThan(0)
    expect(result.metrics.runDurationMs.value ?? 0).toBeGreaterThanOrEqual(1_000)
    expect(result.metrics.firstAudioMs).toMatchObject({ value: null })
    expect(result.metrics.avDriftMicros).toMatchObject({ value: null })
    if (result.metrics.powerProxyDroppedFrameRatio.value !== null) expect(result.metrics.powerProxyDroppedFrameRatio.value).toBeLessThanOrEqual(0.1)
  })
}

async function collect(page: Page, isolated: boolean): Promise<PerformanceResult> {
  await page.goto(`/?performanceAcceptance=smoke&isolated=${String(isolated)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('#performance-start').click({ noWaitAfter: true })
  await page.waitForFunction(() => /^(passed|failed)$/.test(document.body.dataset.status ?? ''), undefined, { timeout: 30_000 })
  const result = await page.evaluate(() => (window as typeof window & { __performanceAcceptance?: PerformanceResult }).__performanceAcceptance)
  if (result === undefined) throw new Error('Performance acceptance did not publish a result')
  return result
}

interface Metric { readonly value: number | null; readonly reason: string | null }
interface PerformanceResult {
  readonly schemaVersion: number
  readonly status: string
  readonly evidenceLevel: string
  readonly scenario: string
  readonly backend: string | null
  readonly environment: { readonly crossOriginIsolated: boolean }
  readonly sample: { readonly sha256: string }
  readonly metrics: Record<string, Metric> & { readonly firstFrameMs: Metric; readonly firstAudioMs: Metric; readonly firstSubtitleMs: Metric; readonly seekLatencyMs: Metric; readonly bufferedAheadMicros: Metric; readonly avDriftMicros: Metric; readonly powerProxyDroppedFrameRatio: Metric; readonly runDurationMs: Metric }
  readonly errorCode: string | null
}
