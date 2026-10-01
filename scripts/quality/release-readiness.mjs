import { validateRealBrowserMatrix } from './real-browser-evidence-schema.mjs'
import { validatePerformanceReport } from './performance-evidence-schema.mjs'

/** Validate evidence, never create it or upgrade pending/automation claims to physical evidence. */
export function validateReleaseReadiness(input, thresholds) {
  const failures = []
  const check = (name, action) => {
    try { action() } catch (cause) { failures.push(`${name}: ${cause instanceof Error ? cause.message : 'Invalid evidence'}`) }
  }
  check('browsers', () => {
    validateRealBrowserMatrix(input.browsers, { requirePassed: true, sampleHashes: input.sampleHashes })
    validateStamp(input.browsers, input)
  })
  check('performance', () => {
    const expected = new Set(['html-video', 'webcodecs'].flatMap((backend) => ['chromium', 'firefox'].flatMap((browser) => [false, true].map((isolated) => `${backend}/${browser}/${isolated}`))))
    const reports = input.performance.filter(({ report }) => report.scenario === 'long-run-30m')
    for (const { report, file } of reports) {
      validatePerformanceReport(report, file, thresholds)
      validateStamp(report, input)
      const key = `${report.backend}/${report.environment.browserName}/${report.environment.crossOriginIsolated}`
      if (!expected.delete(key)) throw new Error(`Duplicate or unexpected long-run row: ${key}`)
    }
    if (expected.size) throw new Error(`long-run matrix incomplete: ${[...expected].join(', ')}`)
  })
  check('docker', () => {
    const report = input.docker
    if (report?.schemaVersion !== 1 || report.evidenceLevel !== 'docker-runtime' || report.result !== 'passed') throw new Error('Docker build/runtime evidence is pending or failed')
    validateStamp(report, input)
    if (!/^sha256:[a-f0-9]{64}$/.test(report.imageId ?? '')) throw new Error('Missing immutable image ID')
    for (const field of ['dockerVersion', 'os']) if (typeof report[field] !== 'string' || !report[field].trim()) throw new Error(`Missing ${field}`)
    for (const name of ['build', 'headers', 'range', 'mime', 'notFound']) if (report.checks?.[name] !== true) throw new Error(`Docker ${name} check has not passed`)
    const modes = new Set([false, true])
    if (!Array.isArray(report.endpoints)) throw new Error('Missing Docker endpoints')
    for (const endpoint of report.endpoints) {
      if (!modes.delete(endpoint.crossOriginIsolated)) throw new Error('Invalid or duplicate Docker isolation mode')
      if (endpoint.playback !== 'passed' || !['single', 'simd'].includes(endpoint.wasmVariant)) throw new Error('Docker endpoints require actual single/SIMD WASM playback')
    }
    if (modes.size) throw new Error('Both Docker isolation modes must be tested')
  })
  return failures
}

function validateStamp(report, input) {
  if (report.sdkVersion !== input.sdkVersion) throw new Error('Evidence SDK version does not match the release')
  if (!/^[a-f0-9]{64}$/.test(report.sourceSha256 ?? '') || report.sourceSha256 !== input.sourceSha256) throw new Error('Evidence source SHA-256 does not match the release')
  if (!Number.isFinite(Date.parse(report.collectedAt ?? ''))) throw new Error('Missing evidence collection time')
}
