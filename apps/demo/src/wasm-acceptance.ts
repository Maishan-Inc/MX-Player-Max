import { MXPlayer } from '@mx-player-max/sdk'

export interface WasmAcceptanceResult {
  readonly status: 'passed' | 'failed'
  readonly isolated: boolean
  readonly selectedBackend: string | null
  readonly attempts: readonly { candidateId: string; kind: string; status: string; errorCode: string | null }[]
  readonly nonEmptyPixels: number
  readonly epoch: number
  readonly queuedFrames: number
  readonly decodeQueueSize: number
  readonly errorCode: string | null
  readonly errorDetail?: string
  readonly decodedFrames?: number
  readonly deliveredFrames?: number
  readonly droppedFrames?: number
  readonly droppedStaleFrames?: number
  readonly clockMediaTime?: number
  readonly clockEpoch?: number
}

declare global {
  interface Window { __wasmAcceptance?: WasmAcceptanceResult }
}

export async function runWasmAcceptance(mode: string): Promise<void> {
  const root = document.getElementById('root')
  if (!root) throw new Error('WASM_ACCEPTANCE_ROOT_MISSING')
  root.innerHTML = '<canvas id="wasm-output" width="642" height="358" style="width:642px;height:358px"></canvas>'
  const canvas = document.getElementById('wasm-output')
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('WASM_ACCEPTANCE_CANVAS_MISSING')
  document.body.dataset.status = 'running'
  forceWebCodecsInitializationFailure()
  if (mode === 'single') disableWasmFeatureValidation()

  let player: MXPlayer | null = null
  try {
    player = new MXPlayer({
      target: canvas,
      source: { kind: 'url', url: new URL('/wasm-vp8.webm', location.href).href },
      intent: 'frame-access',
      wasmBaseUrl: new URL('/wasm/', location.href).href,
      customVideo: { renderer: 'canvas2d', maxDecodedFrames: 4, maxDecodeQueueSize: 4 },
    })
    await player.ready
    await player.play()
    const nonEmptyPixels = await waitForNonEmptyPixels(canvas)
    await player.seek(100_000)
    await player.seek(300_000)
    const stats = player.customVideoStats
    const trace = player.decisionTrace
    window.__wasmAcceptance = {
      status: 'passed',
      isolated: crossOriginIsolated,
      selectedBackend: player.selection?.backend.kind ?? null,
      attempts: trace?.attempts.map((attempt) => ({
        candidateId: attempt.candidateId,
        kind: attempt.kind,
        status: attempt.status,
        errorCode: attempt.errorCode,
      })) ?? [],
      nonEmptyPixels,
      epoch: player.audioClock?.epoch ?? 0,
      queuedFrames: stats?.queuedFrames ?? -1,
      decodeQueueSize: stats?.decodeQueueSize ?? -1,
      errorCode: null,
    }
    document.body.dataset.status = 'passed'
  } catch (cause) {
    const stats = player?.customVideoStats
    const clock = player?.audioClock
    window.__wasmAcceptance = {
      status: 'failed', isolated: crossOriginIsolated, selectedBackend: player?.selection?.backend.kind ?? null,
      attempts: player?.decisionTrace?.attempts.map((attempt) => ({
        candidateId: attempt.candidateId,
        kind: attempt.kind,
        status: attempt.status,
        errorCode: attempt.errorCode,
      })) ?? [],
      nonEmptyPixels: 0,
      epoch: clock?.epoch ?? 0,
      queuedFrames: stats?.queuedFrames ?? -1,
      decodeQueueSize: stats?.decodeQueueSize ?? -1,
      errorCode: safeErrorCode(cause),
      errorDetail: safeErrorDetail(cause),
      ...(stats === null || stats === undefined ? {} : {
        decodedFrames: stats.decodedFrames,
        deliveredFrames: stats.deliveredFrames,
        droppedFrames: stats.droppedFrames,
        droppedStaleFrames: stats.droppedStaleFrames,
      }),
      ...(clock === null || clock === undefined ? {} : {
        clockMediaTime: clock.mediaTime,
        clockEpoch: clock.epoch,
      }),
    }
    document.body.dataset.status = 'failed'
  }
}

function forceWebCodecsInitializationFailure(): void {
  const nativeVideoDecoder = globalThis.VideoDecoder
  if (typeof nativeVideoDecoder === 'undefined') return
  class FailingVideoDecoder {
    static isConfigSupported(config: VideoDecoderConfig): Promise<VideoDecoderSupport> {
      return nativeVideoDecoder.isConfigSupported(config)
    }

    constructor(_init: VideoDecoderInit) {
      throw new DOMException('WebCodecs candidate rejected for atomic fallback acceptance', 'NotSupportedError')
    }
  }
  Object.defineProperty(globalThis, 'VideoDecoder', { configurable: true, value: FailingVideoDecoder })
}

function disableWasmFeatureValidation(): void {
  Object.defineProperty(WebAssembly, 'validate', { configurable: true, value: () => false })
}

async function waitForNonEmptyPixels(canvas: HTMLCanvasElement): Promise<number> {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('WASM_ACCEPTANCE_CONTEXT_MISSING')
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let nonEmpty = 0
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index] ?? 0) !== 0 || (data[index + 1] ?? 0) !== 0 || (data[index + 2] ?? 0) !== 0) nonEmpty += 1
    }
    if (nonEmpty > 0) return nonEmpty
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('WASM_ACCEPTANCE_CANVAS_BLANK')
}

function safeErrorCode(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string') return cause.code
  return 'WASM_ACCEPTANCE_FAILED'
}

function safeErrorDetail(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`
  return String(cause)
}
