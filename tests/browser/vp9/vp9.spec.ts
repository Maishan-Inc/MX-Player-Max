import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Vp9BrowserResult, Vp9Probe } from './harness'

for (const isolated of [false, true]) test(`transfers VP9 profile 2 I420P10 after consecutive seeks (${isolated ? 'isolated' : 'non-isolated'})`, async ({ page }) => {
  const pageErrors: string[] = []
  const wasmRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().endsWith('.wasm')) wasmRequests.push(request.url())
  })
  await page.goto(isolated ? '/?isolated=1' : '/', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => page.evaluate(() => typeof window.__vp9Acceptance)).toBe('object')
  const probe = await page.evaluate<Vp9Probe>(() => window.__vp9Acceptance.probe())
  test.info().annotations.push({ type: 'browser-capability', description: JSON.stringify(probe) })
  const base = { project: test.info().project.name, browserVersion: page.context().browser()?.version(), isolated, probe }
  console.log(`VP9 capability: ${JSON.stringify(base)}`)
  if (!probe.videoFrame || !probe.i420p10 || !probe.worker) {
    await writeFile(test.info().outputPath('vp9-browser-evidence.json'), `${JSON.stringify({ ...base, status: 'unsupported' }, null, 2)}\n`)
    test.skip(true, `10-bit VideoFrame/Worker unavailable: ${JSON.stringify(probe)}`)
  }
  expect(probe.isolated).toBe(isolated)

  const result = await page.evaluate<Vp9BrowserResult>(() => window.__vp9Acceptance.run())
  const evidence = JSON.stringify({ probe, result, pageErrors, wasmRequests }, null, 2)
  expect(pageErrors, evidence).toEqual([])
  expect(result.errors, evidence).toEqual([])
  expect(result.fixtureSha256, evidence).toBe('09ba8a0c2c2b07f42a1a0fc26af56f13d758893c65dabf2fc750037dba92741d')
  expect(result.trackCodec, evidence).toMatch(/^vp09\.02\.\d{2}\.10$/)
  expect(result.resetEpochs, evidence).toEqual([1, 2, 3])
  expect(result.lastEpoch, evidence).toBe(3)
  expect(result.staleFramesDelivered, evidence).toBe(0)
  expect(result.decodedFrames, evidence).toBeGreaterThan(0)
  expect(result.output, evidence).toMatchObject({ format: 'I420P10', visibleWidth: 641, visibleHeight: 359 })
  expect(result.output.codedWidth, evidence).toBeGreaterThanOrEqual(641)
  expect(result.output.codedHeight, evidence).toBeGreaterThanOrEqual(359)
  expect(result.output.timestamp, evidence).toBeGreaterThanOrEqual(400_000)
  expect(result.output.nonzeroBytes, evidence).toBeGreaterThan(0)
  expect(result.output.maxLumaSample, evidence).toBeGreaterThan(255)
  expect(wasmRequests.some((url) => /libvpx-vp9-(single|simd)\.wasm$/.test(url)), evidence).toBe(true)
  expect(wasmRequests.some((url) => url.includes('vp8')), evidence).toBe(false)
  if (isolated) expect(wasmRequests.some((url) => url.endsWith('libvpx-vp9-threaded.wasm')), evidence).toBe(true)
  else expect(wasmRequests.some((url) => url.includes('threaded')), evidence).toBe(false)
  await writeFile(test.info().outputPath('vp9-browser-evidence.json'), `${JSON.stringify({ ...base, status: 'passed', result, pageErrors, wasmRequests }, null, 2)}\n`)
  test.info().annotations.push({ type: 'vp9-browser-evidence', description: evidence })
})
