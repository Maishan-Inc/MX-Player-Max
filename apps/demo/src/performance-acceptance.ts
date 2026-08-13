import { MXPlayer } from '@mx-player-max/sdk'

const SMOKE_SAMPLE = {
  id: 'webm-vp8-p0-8bit-opus',
  path: '/quality-media/webm-vp8-p0-8bit-opus.webm',
  sha256: 'e9e8baf10f81588a257bffe147648c31f5a0c5e5a52b57888e935917749d13b8',
}

interface PerformanceSample {
  readonly id: string
  readonly path: string
  readonly sha256: string
}

interface MetricValue {
  readonly value: number | null
  readonly reason: string | null
}

export interface PerformanceAcceptanceResult {
  readonly schemaVersion: 1
  readonly status: 'passed' | 'failed'
  readonly evidenceLevel: 'playwright-automation'
  readonly scenario: 'smoke' | 'long-run-30m'
  readonly backend: string | null
  readonly environment: {
    readonly userAgent: string
    readonly platform: string
    readonly gpu: string | null
    readonly crossOriginIsolated: boolean
    readonly devicePixelRatio: number
  }
  readonly sample: PerformanceSample
  readonly metrics: {
    readonly firstFrameMs: MetricValue
    readonly firstAudioMs: MetricValue
    readonly firstSubtitleMs: MetricValue
    readonly seekLatencyMs: MetricValue
    readonly bufferedAheadMicros: MetricValue
    readonly droppedFrames: MetricValue
    readonly avDriftMicros: MetricValue
    readonly cpuTimeMs: MetricValue
    readonly memoryBytes: MetricValue
    readonly memoryGrowthBytes: MetricValue
    readonly powerProxyDroppedFrameRatio: MetricValue
    readonly runDurationMs: MetricValue
  }
  readonly memorySamples: readonly { readonly elapsedMs: number; readonly bytes: number }[]
  readonly errorCode: string | null
}

declare global {
  interface Window { __performanceAcceptance?: PerformanceAcceptanceResult }
}

export async function runPerformanceAcceptance(mode: string): Promise<void> {
  const root = document.getElementById('root')
  if (!root) throw new Error('PERFORMANCE_ACCEPTANCE_ROOT_MISSING')
  root.innerHTML = '<main><button id="performance-start" type="button">Start performance acceptance</button><div id="performance-host" style="width:320px;height:180px"></div></main>'
  const button = document.getElementById('performance-start')
  const host = document.getElementById('performance-host')
  if (!(button instanceof HTMLButtonElement) || !(host instanceof HTMLElement)) throw new Error('PERFORMANCE_ACCEPTANCE_TARGET_MISSING')
  document.body.dataset.status = 'waiting'
  button.addEventListener('click', () => { void execute(mode === 'long-run-30m' ? 'long-run-30m' : 'smoke', host) }, { once: true })
}

async function execute(scenario: 'smoke' | 'long-run-30m', host: HTMLElement): Promise<void> {
  document.body.dataset.status = 'running'
  const requestedHash = new URL(location.href).searchParams.get('sampleSha256')
  const sample = scenario === 'long-run-30m'
    ? { id: 'long-run-vp8-opus-30m', path: '/quality-media/long-run-vp8-opus-30m.webm', sha256: requestedHash ?? '' }
    : SMOKE_SAMPLE
  const startedAt = performance.now()
  const memorySamples: Array<{ elapsedMs: number; bytes: number }> = []
  let firstSubtitleMs: number | null = null
  let player: MXPlayer | null = null
  try {
    if (scenario === 'long-run-30m' && !/^[a-f0-9]{64}$/.test(sample.sha256)) {
      throw codedError('PERFORMANCE_LONG_RUN_SHA256_REQUIRED', 'Long-run evidence requires the generated media SHA-256')
    }
    player = new MXPlayer({
      target: host,
      source: { kind: 'url', url: new URL(sample.path, location.href).href },
      intent: 'normal',
      native: { preload: 'auto', crossOrigin: 'anonymous' },
      subtitles: { enabled: true },
    })
    player.on('subtitlecuechange', (event) => {
      if (firstSubtitleMs === null && event.cues.length > 0) firstSubtitleMs = performance.now() - startedAt
    })
    await player.ready
    const subtitleText = await fetch('/quality-subtitles/basic-timing.srt').then((response) => response.text())
    const track = await player.addSubtitleTrack({ kind: 'file', file: new File([subtitleText], 'basic-timing.srt', { type: 'text/plain' }), format: 'srt' })
    await player.selectSubtitleTrack(track.id)
    const initialMemory = readMemoryBytes()
    if (initialMemory !== null) memorySamples.push({ elapsedMs: performance.now() - startedAt, bytes: initialMemory })
    await player.play()
    await waitFor(() => (player?.nativeStats?.presentedFrames ?? 0) > 0, 10_000)
    const firstFrameMs = performance.now() - startedAt
    await waitFor(() => firstSubtitleMs !== null, 3_000)

    const seekStartedAt = performance.now()
    await player.seek(1_500_000)
    const seekLatencyMs = performance.now() - seekStartedAt
    await player.play()
    const runDurationMs = scenario === 'long-run-30m' ? 1_800_000 : 1_000
    const samplingStartedAt = performance.now()
    while (performance.now() - samplingStartedAt < runDurationMs) {
      const memory = readMemoryBytes()
      if (memory !== null) memorySamples.push({ elapsedMs: performance.now() - startedAt, bytes: memory })
      await delay(scenario === 'long-run-30m' ? 30_000 : 200)
    }
    player.pause()
    const stats = player.nativeStats
    const finalMemory = readMemoryBytes()
    const presented = stats?.presentedFrames ?? 0
    const dropped = stats?.droppedFrames
    const droppedRatio = dropped === null || dropped === undefined ? null : dropped / Math.max(1, presented + dropped)
    publish({
      schemaVersion: 1,
      status: 'passed',
      evidenceLevel: 'playwright-automation',
      scenario,
      backend: player.selection?.backend.kind ?? null,
      environment: environment(),
      sample,
      metrics: {
        firstFrameMs: measured(firstFrameMs),
        firstAudioMs: unavailable('Native playback exposes no first-audible-sample timestamp'),
        firstSubtitleMs: measured(firstSubtitleMs),
        seekLatencyMs: measured(seekLatencyMs),
        bufferedAheadMicros: measured(player.playback.bufferedAhead),
        droppedFrames: dropped === null || dropped === undefined ? unavailable('Browser did not expose dropped-frame statistics') : measured(dropped),
        avDriftMicros: unavailable('Native audio/video clocks are not independently observable'),
        cpuTimeMs: unavailable('Browser automation exposes no process CPU metric'),
        memoryBytes: finalMemory === null ? unavailable('performance.memory is unavailable') : measured(finalMemory),
        memoryGrowthBytes: initialMemory === null || finalMemory === null ? unavailable('performance.memory is unavailable') : measured(finalMemory - initialMemory),
        powerProxyDroppedFrameRatio: droppedRatio === null ? unavailable('Dropped-frame power proxy is unavailable') : measured(droppedRatio),
        runDurationMs: measured(performance.now() - samplingStartedAt),
      },
      memorySamples,
      errorCode: null,
    })
  } catch (cause) {
    publish({
      schemaVersion: 1,
      status: 'failed',
      evidenceLevel: 'playwright-automation',
      scenario,
      backend: player?.selection?.backend.kind ?? null,
      environment: environment(),
      sample,
      metrics: emptyMetrics(),
      memorySamples,
      errorCode: errorCode(cause),
    })
  } finally {
    player?.destroy()
  }
}

function publish(result: PerformanceAcceptanceResult): void {
  window.__performanceAcceptance = result
  document.body.dataset.status = result.status
}

function measured(value: number | null): MetricValue { return { value, reason: null } }
function unavailable(reason: string): MetricValue { return { value: null, reason } }
function emptyMetrics(): PerformanceAcceptanceResult['metrics'] {
  const missing = unavailable('Scenario did not complete')
  return { firstFrameMs: missing, firstAudioMs: missing, firstSubtitleMs: missing, seekLatencyMs: missing, bufferedAheadMicros: missing, droppedFrames: missing, avDriftMicros: missing, cpuTimeMs: missing, memoryBytes: missing, memoryGrowthBytes: missing, powerProxyDroppedFrameRatio: missing, runDurationMs: missing }
}

function environment(): PerformanceAcceptanceResult['environment'] {
  return { userAgent: navigator.userAgent, platform: navigator.platform, gpu: gpuName(), crossOriginIsolated, devicePixelRatio }
}

function gpuName(): string | null {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl')
  if (!context) return null
  const extension = context.getExtension('WEBGL_debug_renderer_info')
  if (!extension) return null
  const value: unknown = context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
  return typeof value === 'string' ? value.slice(0, 256) : null
}

function readMemoryBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize
  return typeof memory === 'number' && Number.isFinite(memory) ? memory : null
}

function errorCode(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string') return cause.code
  return 'PERFORMANCE_ACCEPTANCE_FAILED'
}

function codedError(code: string, message: string): Error & { readonly code: string } {
  return Object.assign(new Error(message), { code })
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('PERFORMANCE_ACCEPTANCE_TIMEOUT')
    await delay(20)
  }
}

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }
