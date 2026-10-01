import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validateReleaseReadiness } from '../release-readiness.mjs'
import { PERFORMANCE_METRICS, LONG_RUN_SAMPLE } from '../performance-evidence-schema.mjs'
import { validateRealBrowserMatrix } from '../real-browser-evidence-schema.mjs'

const thresholds = JSON.parse(await readFile(new URL('../../../tests/performance/thresholds.json', import.meta.url), 'utf8'))
const pending = JSON.parse(await readFile(new URL('../../../tests/browser/evidence/real-browser-matrix.json', import.meta.url), 'utf8'))
const sourceSha256 = 'a'.repeat(64)
const sampleSha256 = 'b'.repeat(64)
const stamp = { sdkVersion: '0.1.0', sourceSha256, collectedAt: '2026-10-01T00:00:00.000Z' }

test('ordinary evidence validation accepts honest pending rows; release validation rejects them', () => {
  assert.equal(validateRealBrowserMatrix(pending).pending, 6)
  const input = complete()
  input.browsers = pending
  assert.match(validateReleaseReadiness(input, thresholds).join('\n'), /browsers.*pending/)
})

test('release requires measured long runs on both backends and both isolation modes', () => {
  const input = complete()
  assert.deepEqual(validateReleaseReadiness(input, thresholds), [])
  input.performance.pop()
  assert.match(validateReleaseReadiness(input, thresholds).join('\n'), /long-run.*incomplete/)
  input.performance = []
  assert.match(validateReleaseReadiness(input, thresholds).join('\n'), /long-run.*incomplete/)
})

test('release refuses stale versions, source hashes, absent measurements and failed reports', () => {
  for (const mutate of [
    (input) => { input.browsers.sdkVersion = '0.0.9' },
    (input) => { input.docker.sourceSha256 = 'c'.repeat(64) },
    (input) => { input.performance[0].report.metrics.avDriftMicros = { value: null, reason: 'Not observable' } },
    (input) => { input.performance[0].report.status = 'failed' },
  ]) {
    const input = complete()
    mutate(input)
    assert.ok(validateReleaseReadiness(input, thresholds).length > 0)
  }
})

test('release rejects schema-only Docker claims and incomplete isolation playback', () => {
  const input = complete()
  input.docker.checks.range = false
  assert.match(validateReleaseReadiness(input, thresholds).join('\n'), /docker.*range/)
  input.docker.checks.range = true
  input.docker.endpoints[1].wasmVariant = 'threaded'
  assert.match(validateReleaseReadiness(input, thresholds).join('\n'), /docker.*single|docker.*simd/)
})

test('browser evidence rejects contradictory passes, fake environments and duplicate stable versions', () => {
  for (const mutate of [
    (input) => { input.browsers.rows[0].native = 'pending' },
    (input) => { input.browsers.rows[0].browserVersion = 'headless 153' },
    (input) => { input.browsers.rows[1].browserVersion = input.browsers.rows[0].browserVersion },
    (input) => { input.browsers.rows[4].os = 'Windows 11' },
  ]) {
    const input = complete()
    mutate(input)
    assert.ok(validateReleaseReadiness(input, thresholds).length > 0)
  }
})

test('unsupported custom backends need explicit capability reasons in passed real-browser evidence', () => {
  const input = complete()
  input.browsers.rows[4].webcodecs = 'unsupported'
  assert.ok(validateReleaseReadiness(input, thresholds).length > 0)
  input.browsers.rows[4].backendReasons = { webcodecs: 'The tested configuration is rejected by isConfigSupported.' }
  assert.deepEqual(validateReleaseReadiness(input, thresholds), [])
})

function complete() {
  return {
    sdkVersion: stamp.sdkVersion, sourceSha256, sampleHashes: new Set([sampleSha256]),
    browsers: {
      schemaVersion: 1, evidenceLevel: 'real-browser', ...stamp,
      rows: ['chrome', 'firefox', 'safari'].flatMap((browser) => ['latest', 'latest-1'].map((stableSlot, index) => ({
        browser, stableSlot, browserVersion: `${153 - index}.0.0`, os: browser === 'safari' ? 'macOS 26' : 'Windows 11',
        gpu: 'physical test fixture GPU', crossOriginIsolated: true, sampleSha256,
        native: 'passed', webcodecs: 'passed', wasm: 'passed', result: 'passed',
      }))),
    },
    performance: ['html-video', 'webcodecs'].flatMap((backend) => ['chromium', 'firefox'].flatMap((browserName) => [false, true].map((isolated) => ({
      file: `${backend}-${browserName}-${isolated}.json`,
      report: {
        schemaVersion: 1, evidenceLevel: 'playwright-automation', status: 'passed', scenario: 'long-run-30m', backend,
        ...stamp, errorCode: null, sample: { ...LONG_RUN_SAMPLE, sha256: sampleSha256 },
        environment: { browserName, browserVersion: '153.0', os: 'Test OS', userAgent: 'Test UA', platform: 'Test', gpu: 'Test GPU', crossOriginIsolated: isolated, devicePixelRatio: 1 },
        metrics: Object.fromEntries(PERFORMANCE_METRICS.map((name) => [name, {
          value: name === 'runDurationMs' ? 1_800_000 : name === 'bufferedAheadMicros' ? 100_000 : 0, reason: null,
        }])), memorySamples: [{ elapsedMs: 0, bytes: 100 }],
      },
    })))),
    docker: {
      schemaVersion: 1, evidenceLevel: 'docker-runtime', result: 'passed', ...stamp,
      imageId: `sha256:${'d'.repeat(64)}`, dockerVersion: 'Test Docker', os: 'Test OS',
      checks: { build: true, headers: true, range: true, mime: true, notFound: true },
      endpoints: [false, true].map((isolated) => ({ crossOriginIsolated: isolated, playback: 'passed', wasmVariant: 'single' })),
    },
  }
}
