const HASH_PATTERN = /^[a-f0-9]{64}$/

export const PERFORMANCE_METRICS = Object.freeze([
  'firstFrameMs',
  'firstAudioMs',
  'firstSubtitleMs',
  'seekLatencyMs',
  'bufferedAheadMicros',
  'droppedFrames',
  'avDriftMicros',
  'cpuTimeMs',
  'memoryBytes',
  'memoryGrowthBytes',
  'powerProxyDroppedFrameRatio',
  'runDurationMs',
])

const NON_NEGATIVE_METRICS = new Set(PERFORMANCE_METRICS.filter((name) => name !== 'avDriftMicros'))

export const SMOKE_SAMPLE = Object.freeze({
  id: 'webm-vp8-p0-8bit-opus',
  path: '/quality-media/webm-vp8-p0-8bit-opus.webm',
  sha256: 'e9e8baf10f81588a257bffe147648c31f5a0c5e5a52b57888e935917749d13b8',
})

export const LONG_RUN_SAMPLE = Object.freeze({
  id: 'long-run-vp8-opus-30m',
  path: '/quality-media/long-run-vp8-opus-30m.webm',
})

export function validatePerformanceReport(report, file, thresholds) {
  if (!isRecord(report) || report.schemaVersion !== 1 || report.status !== 'passed' || report.evidenceLevel !== 'playwright-automation') {
    throw new Error(`${file}: invalid schema, status, or evidence level`)
  }
  if (!Number.isFinite(Date.parse(report.collectedAt ?? ''))) throw new Error(`${file}: invalid collection time`)
  if (report.errorCode !== null) throw new Error(`${file}: passed evidence must not contain an error code`)
  if (!['smoke', 'long-run-30m'].includes(report.scenario)) throw new Error(`${file}: invalid scenario`)
  validateEnvironment(report.environment, file)
  validateSample(report.sample, report.scenario, file)
  validateMetrics(report.metrics, file)
  validateMemorySamples(report.memorySamples, file)

  if (report.scenario === 'smoke') {
    assertMaximum(report, file, 'firstFrameMs', thresholds.smoke.firstFrameMsMax)
    assertOptionalMaximum(report, file, 'firstAudioMs', thresholds.smoke.firstAudioMsMax)
    assertMaximum(report, file, 'firstSubtitleMs', thresholds.smoke.firstSubtitleMsMax)
    assertMaximum(report, file, 'seekLatencyMs', thresholds.smoke.seekLatencyMsMax)
    assertMinimum(report, file, 'bufferedAheadMicros', thresholds.smoke.bufferedAheadMicrosMin)
    assertMaximum(report, file, 'droppedFrames', thresholds.smoke.droppedFramesMax)
    assertOptionalAbsoluteMaximum(report, file, 'avDriftMicros', thresholds.smoke.avDriftMicrosMax)
    assertOptionalMaximum(report, file, 'cpuTimeMs', thresholds.smoke.cpuTimeMsMax)
    assertOptionalMaximum(report, file, 'memoryBytes', thresholds.smoke.memoryBytesMax)
    assertOptionalMaximum(report, file, 'powerProxyDroppedFrameRatio', thresholds.smoke.droppedFrameRatioMax)
    assertOptionalMaximum(report, file, 'memoryGrowthBytes', thresholds.smoke.memoryGrowthBytesMax)
    assertMinimum(report, file, 'runDurationMs', thresholds.smoke.runDurationMsMin)
  } else {
    assertMaximum(report, file, 'firstFrameMs', thresholds.longRun30m.firstFrameMsMax)
    assertMaximum(report, file, 'firstAudioMs', thresholds.longRun30m.firstAudioMsMax)
    assertMaximum(report, file, 'firstSubtitleMs', thresholds.longRun30m.firstSubtitleMsMax)
    assertMaximum(report, file, 'seekLatencyMs', thresholds.longRun30m.seekLatencyMsMax)
    assertMinimum(report, file, 'bufferedAheadMicros', thresholds.longRun30m.bufferedAheadMicrosMin)
    assertMaximum(report, file, 'droppedFrames', thresholds.longRun30m.droppedFramesMax)
    assertMinimum(report, file, 'runDurationMs', thresholds.longRun30m.runDurationMsMin)
    assertMaximum(report, file, 'avDriftMicros', thresholds.longRun30m.avDriftMicrosMax)
    assertMaximum(report, file, 'cpuTimeMs', thresholds.longRun30m.cpuTimeMsMax)
    assertMaximum(report, file, 'memoryBytes', thresholds.longRun30m.memoryBytesMax)
    assertMaximum(report, file, 'memoryGrowthBytes', thresholds.longRun30m.memoryGrowthBytesMax)
    assertMaximum(report, file, 'powerProxyDroppedFrameRatio', thresholds.longRun30m.droppedFrameRatioMax)
  }
}

export function validatePerformanceMatrix(reports) {
  const requiredSmoke = new Set(['chromium/non-isolated', 'chromium/isolated', 'firefox/non-isolated', 'firefox/isolated'])
  const observed = new Set()
  for (const { report, file } of reports) {
    const key = `${report.environment.browserName}/${report.environment.crossOriginIsolated ? 'isolated' : 'non-isolated'}`
    const scenarioKey = `${report.scenario}/${key}`
    if (observed.has(scenarioKey)) throw new Error(`${file}: duplicate performance matrix row ${scenarioKey}`)
    observed.add(scenarioKey)
    if (report.scenario === 'smoke') requiredSmoke.delete(key)
  }
  if (requiredSmoke.size > 0) throw new Error(`Performance smoke matrix is incomplete: ${[...requiredSmoke].join(', ')}`)

  const longRunRows = [...observed].filter((key) => key.startsWith('long-run-30m/'))
  if (longRunRows.length !== 0 && longRunRows.length !== 4) throw new Error('Long-run performance evidence must contain all four browser/isolation rows')
}

function validateEnvironment(environment, file) {
  if (!isRecord(environment)) throw new Error(`${file}: missing environment metadata`)
  for (const field of ['userAgent', 'platform', 'gpu', 'browserName', 'browserVersion', 'os']) {
    if (typeof environment[field] !== 'string' || environment[field].trim().length === 0) throw new Error(`${file}: invalid environment.${field}`)
  }
  if (!['chromium', 'firefox'].includes(environment.browserName)) throw new Error(`${file}: unsupported automation browser`)
  if (typeof environment.crossOriginIsolated !== 'boolean') throw new Error(`${file}: invalid environment.crossOriginIsolated`)
  if (!Number.isFinite(environment.devicePixelRatio) || environment.devicePixelRatio <= 0) throw new Error(`${file}: invalid environment.devicePixelRatio`)
}

function validateSample(sample, scenario, file) {
  if (!isRecord(sample) || !HASH_PATTERN.test(sample.sha256 ?? '')) throw new Error(`${file}: invalid sample SHA-256`)
  const expected = scenario === 'smoke' ? SMOKE_SAMPLE : LONG_RUN_SAMPLE
  if (sample.id !== expected.id || sample.path !== expected.path) throw new Error(`${file}: scenario uses the wrong media sample`)
  if (scenario === 'smoke' && sample.sha256 !== SMOKE_SAMPLE.sha256) throw new Error(`${file}: smoke sample SHA-256 does not match the manifest`)
  if (scenario === 'long-run-30m' && sample.sha256 === SMOKE_SAMPLE.sha256) throw new Error(`${file}: long-run evidence cannot reuse the seed SHA-256`)
}

function validateMetrics(metrics, file) {
  if (!isRecord(metrics)) throw new Error(`${file}: missing metrics`)
  for (const name of PERFORMANCE_METRICS) {
    const metric = metrics[name]
    if (!isRecord(metric) || !Object.hasOwn(metric, 'value') || !Object.hasOwn(metric, 'reason')) throw new Error(`${file}: invalid metric ${name}`)
    if (metric.value === null && (typeof metric.reason !== 'string' || metric.reason.trim().length === 0)) throw new Error(`${file}: unavailable metric ${name} needs a reason`)
    if (metric.value !== null && (!Number.isFinite(metric.value) || metric.reason !== null)) throw new Error(`${file}: measured metric ${name} is invalid`)
    if (typeof metric.value === 'number' && NON_NEGATIVE_METRICS.has(name) && metric.value < 0) throw new Error(`${file}: metric ${name} cannot be negative`)
  }
  const droppedRatio = metrics.powerProxyDroppedFrameRatio.value
  if (typeof droppedRatio === 'number' && droppedRatio > 1) throw new Error(`${file}: dropped-frame ratio must be in [0, 1]`)
}

function validateMemorySamples(memorySamples, file) {
  if (!Array.isArray(memorySamples)) throw new Error(`${file}: memorySamples must be an array`)
  for (const sample of memorySamples) {
    if (!isRecord(sample) || !Number.isFinite(sample.elapsedMs) || sample.elapsedMs < 0 || !Number.isFinite(sample.bytes) || sample.bytes < 0) {
      throw new Error(`${file}: invalid memory sample`)
    }
  }
}

function assertMaximum(report, file, metric, maximum) {
  const value = report.metrics[metric]?.value
  const compared = metric === 'avDriftMicros' && typeof value === 'number' ? Math.abs(value) : value
  if (typeof compared !== 'number' || compared > maximum) throw new Error(`${file}: ${metric} exceeds ${maximum}`)
}

function assertOptionalMaximum(report, file, metric, maximum) {
  const value = report.metrics[metric]?.value
  if (value !== null && (typeof value !== 'number' || value > maximum)) throw new Error(`${file}: ${metric} exceeds ${maximum}`)
}

function assertOptionalAbsoluteMaximum(report, file, metric, maximum) {
  const value = report.metrics[metric]?.value
  if (value !== null && (typeof value !== 'number' || Math.abs(value) > maximum)) throw new Error(`${file}: ${metric} exceeds ${maximum}`)
}

function assertMinimum(report, file, metric, minimum) {
  const value = report.metrics[metric]?.value
  if (typeof value !== 'number' || value < minimum) throw new Error(`${file}: ${metric} is below ${minimum}`)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
