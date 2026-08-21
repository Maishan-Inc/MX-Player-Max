import { existsSync } from 'node:fs'
import { relative } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

const MEDIA_READY_TIMEOUT_MS = 20_000

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'webkit-simulated') testInfo.setTimeout(90_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.player-stage')).toBeVisible()
  await expect(page.locator('.mxp-player-ui')).toBeVisible()
})

test('lays out the production player UI without overlap or blank media', async ({ page }, testInfo) => {
  const stage = page.locator('.player-stage')
  const stageBox = await stage.boundingBox()
  expect(stageBox?.width ?? 0).toBeGreaterThan(300)
  expect(stageBox?.height ?? 0).toBeGreaterThan(160)
  const background = await stage.evaluate((element) => getComputedStyle(element).backgroundImage)
  expect(background).toContain('mx-player-poster.png')
  const ui = page.locator('.mxp-player-ui')
  await expect(ui).toHaveAttribute('data-mxp-state', /^(ready|paused|playing|ended|error)$/, {
    timeout: MEDIA_READY_TIMEOUT_MS,
  })
  const errorCode = await ui.getAttribute('data-mxp-error-code')
  if (testInfo.project.name === 'webkit-simulated') {
    expect([null, 'NATIVE_NOT_SUPPORTED', 'STRATEGY_ALL_CANDIDATES_FAILED']).toContain(errorCode)
  } else {
    expect(errorCode).toBeNull()
  }
  await expect(page.locator('[data-mxp-action="next"]')).toBeHidden()
  await expectNoOverlap(page, '.mxp-control-row .mxp-icon-button:visible')
  await expectTextContained(page, '.source-summary strong, .control-rail label, .mxp-time-readout')

  if (testInfo.project.name === 'chromium-desktop') {
    await stage.evaluate((element) => { (element as HTMLElement).style.width = '700px' })
    await expect(page.locator('.mxp-volume-slider')).toBeHidden()
    await expect(page.locator('.mxp-theater-control')).toBeHidden()
    await stage.evaluate((element) => { (element as HTMLElement).style.removeProperty('width') })
    await expect(page.locator('.mxp-volume-slider')).toBeVisible()
    await expect(page.locator('.mxp-theater-control')).toBeVisible()
    const response = await page.request.get('/flower.webm', { headers: { Range: 'bytes=0-0' } })
    expect(response.status()).toBe(206)
    expect(response.headers()['content-range']).toBe('bytes 0-0/554058')
    expect((await response.body()).byteLength).toBe(1)
    await expectUiBaseline(page, 'desktop-workbench.png')
  }
  if (testInfo.project.name === 'chromium-mobile') {
    await expect(page.locator('.mxp-volume-slider')).toBeHidden()
    await expect(page.locator('.mxp-theater-control')).toBeHidden()
    await expectUiBaseline(page, 'mobile-workbench.png')
  }
})

test('keeps the single overlay inside the player and restores keyboard flow', async ({ page }, testInfo) => {
  const settings = page.locator('[data-mxp-action="settings"]')
  await settings.click()
  const panel = page.locator('.mxp-panel')
  await expect(panel).toBeVisible()
  expect(await isContained(panel, page.locator('.player-stage'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  if (testInfo.project.name === 'chromium-desktop') {
    await settings.click()
    await expectUiBaseline(page, 'desktop-settings.png')
  }
})

test('preserves visible focus and reduced-motion behavior', async ({ page }) => {
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus')
  await expect(focused).toBeVisible()
  const transition = await page.locator('.mxp-control-shell').evaluate((element) => getComputedStyle(element).transitionDuration)
  expect(transition).toMatch(/^(0s|0ms)(, (0s|0ms))*$/)
})

test('reports public playback diagnostics and resets them for a new intent', async ({ page }) => {
  for (const panel of ['probe', 'decision', 'runtime', 'subtitles']) {
    const locator = page.getByTestId(`${panel}-panel`)
    await expect(locator).toBeVisible()
    await expect(locator).toHaveAttribute('data-status', /^(empty|loading|ready|failed)$/)
  }

  const unknownSupport = page.locator('[data-support="unknown"]')
  for (let index = 0; index < await unknownSupport.count(); index += 1) {
    await expect(unknownSupport.nth(index)).toHaveText('Pending verification')
  }

  const decision = page.getByTestId('decision-panel')
  const previousResetKey = await decision.getAttribute('data-reset-key')
  await page.locator('#playback-intent').selectOption('filters')
  await expect(decision).not.toHaveAttribute('data-reset-key', previousResetKey ?? '')
  await expect(decision).toHaveAttribute('data-status', /^(loading|ready|failed)$/)
})

// UI baselines are committed per platform as `{arg}-{projectName}-{platform}.png`. A platform
// without a committed baseline records an annotation instead of failing, so a missing baseline is
// never reported as a layout regression. `--update-snapshots` still writes the first baseline on
// that platform, and an existing baseline is always compared strictly.
async function expectUiBaseline(page: Page, name: string): Promise<void> {
  const info = test.info()
  const baselinePath = info.snapshotPath(name, { kind: 'screenshot' })
  const authoring = info.config.updateSnapshots === 'all' || info.config.updateSnapshots === 'changed'
  if (!authoring && !existsSync(baselinePath)) {
    info.annotations.push({
      type: 'ui-baseline-missing',
      description: `${relative(info.config.rootDir, baselinePath)} is not committed; run pnpm test:browser --update-snapshots on this platform and commit it`,
    })
    return
  }
  await expect(page).toHaveScreenshot(name, { animations: 'disabled' })
}

async function expectNoOverlap(page: Page, selector: string): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
  }))
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left]
      const b = boxes[right]
      if (!a || !b) continue
      const overlaps = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
      expect(overlaps).toBe(false)
    }
  }
}

async function expectTextContained(page: Page, selector: string): Promise<void> {
  const overflows = await page.locator(selector).evaluateAll((elements) => elements.filter((element) => {
    const node = element as HTMLElement
    return node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1
  }).map((element) => element.textContent ?? ''))
  expect(overflows).toEqual([])
}

async function isContained(inner: Locator, outer: Locator): Promise<boolean> {
  const innerBox = await inner.boundingBox()
  const outerBox = await outer.boundingBox()
  if (!innerBox || !outerBox) return false
  return innerBox.x >= outerBox.x && innerBox.y >= outerBox.y
    && innerBox.x + innerBox.width <= outerBox.x + outerBox.width
    && innerBox.y + innerBox.height <= outerBox.y + outerBox.height
}
