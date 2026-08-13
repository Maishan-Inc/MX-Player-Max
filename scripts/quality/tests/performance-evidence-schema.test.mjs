import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PERFORMANCE_METRICS, SMOKE_SAMPLE, validatePerformanceMatrix, validatePerformanceReport } from '../performance-evidence-schema.mjs'

const thresholds = JSON.parse(await readFile(new URL('../../../tests/performance/thresholds.json', import.meta.url), 'utf8'))

test('accepts a complete smoke report', () => {
  assert.doesNotThrow(() => validatePerformanceReport(report(), 'complete.json', thresholds))
})

test('rejects a missing metric', () => {
  const value = report()
  delete value.metrics.cpuTimeMs
  assert.throws(() => validatePerformanceReport(value, 'missing-metric.json', thresholds), /cpuTimeMs/)
})

test('rejects incomplete environment metadata', () => {
  const value = report()
  value.environment.gpu = null
  assert.throws(() => validatePerformanceReport(value, 'missing-gpu.json', thresholds), /environment\.gpu/)
})

test('rejects a long-run report that reuses the seed hash', () => {
  const value = report()
  value.scenario = 'long-run-30m'
  value.sample = { id: 'long-run-vp8-opus-30m', path: '/quality-media/long-run-vp8-opus-30m.webm', sha256: SMOKE_SAMPLE.sha256 }
  value.metrics.runDurationMs = { value: 1_800_000, reason: null }
  value.metrics.avDriftMicros = { value: 0, reason: null }
  assert.throws(() => validatePerformanceReport(value, 'seed-hash.json', thresholds), /cannot reuse the seed SHA-256/)
})

test('rejects negative latency and counters', () => {
  const value = report()
  value.metrics.seekLatencyMs.value = -1
  assert.throws(() => validatePerformanceReport(value, 'negative-latency.json', thresholds), /cannot be negative/)
})

test('rejects dropped-frame ratios outside the unit interval', () => {
  const value = report()
  value.metrics.powerProxyDroppedFrameRatio.value = 1.1
  assert.throws(() => validatePerformanceReport(value, 'invalid-ratio.json', thresholds), /must be in \[0, 1\]/)
})

test('checks the absolute long-run drift', () => {
  const value = report()
  value.scenario = 'long-run-30m'
  value.sample = { id: 'long-run-vp8-opus-30m', path: '/quality-media/long-run-vp8-opus-30m.webm', sha256: '1'.repeat(64) }
  value.metrics.runDurationMs = { value: 1_800_000, reason: null }
  value.metrics.avDriftMicros = { value: -50_001, reason: null }
  assert.throws(() => validatePerformanceReport(value, 'negative-drift.json', thresholds), /avDriftMicros exceeds/)
})

test('requires the complete browser and isolation smoke matrix', () => {
  const reports = [
    matrixRow('chromium', false),
    matrixRow('chromium', true),
    matrixRow('firefox', false),
  ]
  assert.throws(() => validatePerformanceMatrix(reports), /matrix is incomplete/)
  reports.push(matrixRow('firefox', true))
  assert.doesNotThrow(() => validatePerformanceMatrix(reports))
})

test('rejects duplicate matrix rows', () => {
  const reports = [matrixRow('chromium', false), matrixRow('chromium', false)]
  assert.throws(() => validatePerformanceMatrix(reports), /duplicate performance matrix row/)
})

function report() {
  const metrics = Object.fromEntries(PERFORMANCE_METRICS.map((name) => [name, { value: 0, reason: null }]))
  metrics.firstFrameMs.value = 100
  metrics.firstSubtitleMs.value = 200
  metrics.seekLatencyMs.value = 50
  metrics.bufferedAheadMicros.value = 1_000_000
  metrics.runDurationMs.value = 1_000
  return {
    schemaVersion: 1,
    status: 'passed',
    evidenceLevel: 'playwright-automation',
    scenario: 'smoke',
    backend: 'html-video',
    environment: {
      userAgent: 'test agent', platform: 'test platform', gpu: 'test gpu', crossOriginIsolated: true,
      devicePixelRatio: 1, browserName: 'chromium', browserVersion: '151.0.0.0', os: 'test os',
    },
    sample: { ...SMOKE_SAMPLE },
    metrics,
    memorySamples: [{ elapsedMs: 0, bytes: 1 }],
    errorCode: null,
    collectedAt: '2026-08-13T00:00:00.000Z',
  }
}

function matrixRow(browserName, isolated) {
  const value = report()
  value.environment.browserName = browserName
  value.environment.crossOriginIsolated = isolated
  return { report: value, file: `${browserName}-${isolated}.json` }
}
