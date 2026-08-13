import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AudioClockSnapshot,
  CapabilityContext,
  CapabilitySnapshot,
  CustomAudioStats,
  CustomVideoStats,
  DecodedVideoFrame,
  MediaCapabilityReport,
  MediaDescriptor,
  PlaybackSelection,
  StrategyEvaluation,
} from '@mx-player-max/types'
import type { VideoDecoderAdapterCallbacks, VideoDecoderAdapterLike } from '@mx-player-max/decoder-worker'
import type { CustomMediaPipeline, CustomMediaPipelineOptions } from '../src/index'
import { FakeVideo } from './fake-video'

const mocks = vi.hoisted(() => {
  const media: MediaDescriptor = {
    container: 'webm', duration: 1_000_000, size: 100, mimeType: 'video/webm',
    tracks: [{ id: 1, kind: 'video', codecId: 'V_VP8', codec: 'vp8', width: 640, height: 360, frameRate: 30 }],
  }
  const snapshot: CapabilitySnapshot = {
    schemaVersion: 1, sdkVersion: 'test', browser: 'unknown', browserVersion: null, platform: 'unknown',
    crossOriginIsolated: false, sharedArrayBuffer: false, wasmSimd: false, wasmThreads: false,
    htmlVideo: false, mediaCapabilities: true, webCodecsVideo: true, webCodecsAudio: false,
    webGpu: false, webGl2: false, canvas2d: true, workerMediaSource: false,
    webGpuFeatures: { available: false, float32Filterable: false, shaderF16: false, maxComputeWorkgroupStorageSize: 0, maxTextureDimension2d: 0, maxBufferSize: 0, importExternalTexture: false, adapterVendor: null, adapterArchitecture: null, isFallbackAdapter: false },
    quirks: [],
  }
  const report: MediaCapabilityReport = {
    schemaVersion: 1,
    query: { container: 'webm', mimeType: 'video/webm', video: { codec: 'vp8', codedWidth: 640, codedHeight: 360, framerate: 30 }, audio: null },
    native: {
      video: { status: 'unsupported', reasons: [], contentType: null, canPlayType: '' },
      audio: { status: 'unknown', reasons: ['track-absent'], contentType: null, canPlayType: '' },
      playable: 'unsupported', reasons: [],
    },
    webCodecs: {
      video: { status: 'supported', reasons: [], configPresent: true },
      audio: { status: 'unknown', reasons: ['track-absent'], configPresent: false },
      playable: 'supported', reasons: [],
    },
  }
  const webCodecs = { id: 'webcodecs-custom', kind: 'webcodecs', videoCodec: 'vp8', audioCodec: null, renderer: 'canvas2d', score: 90, reasons: ['custom'], requires: ['VideoDecoder'] } as const
  const wasm = { id: 'wasm-custom', kind: 'wasm', videoCodec: 'vp8', audioCodec: null, renderer: 'canvas2d', score: 80, reasons: ['declared-wasm-decoder'], requires: ['declared-wasm-decoder'] } as const
  const contexts: CapabilityContext[] = []
  return {
    media,
    snapshot,
    report,
    webCodecs,
    wasm,
    contexts,
    createPlugin: vi.fn(),
    createWorker: vi.fn(),
    createRangeLoader: vi.fn(() => ({ close: vi.fn(), read: vi.fn() })),
    probeContainer: vi.fn(async () => ({
      adapter: {},
      metadata: { container: media.container, media, tracks: media.tracks, duration: media.duration, size: media.size, hasSeekIndex: true },
      demuxer: { close: vi.fn() },
    })),
    detectCapabilities: vi.fn(async () => snapshot),
    probeMediaCapabilities: vi.fn(async () => report),
  }
})

vi.mock('@mx-player-max/demux', () => ({ createRangeLoader: mocks.createRangeLoader, probeContainer: mocks.probeContainer }))
vi.mock('@mx-player-max/capabilities', () => ({
  createCapabilityContext: (snapshot: CapabilitySnapshot, media: MediaCapabilityReport, wasmDecoders?: CapabilityContext['wasmDecoders']): CapabilityContext => {
    const context = { snapshot, media, ...(wasmDecoders === undefined ? {} : { wasmDecoders }) }
    mocks.contexts.push(context)
    return context
  },
  detectCapabilities: mocks.detectCapabilities,
  detectWasmCapabilities: async (snapshot: CapabilitySnapshot) => snapshot,
  probeMediaCapabilities: mocks.probeMediaCapabilities,
}))
vi.mock('@mx-player-max/platform', () => ({ createPlatformPolicy: () => ({ adjustScores: () => [] }) }))
vi.mock('@mx-player-max/strategy', () => ({
  createStrategyEngine: () => ({
    evaluate(_media: MediaDescriptor, intent: PlaybackSelection['intent'], context: CapabilityContext): StrategyEvaluation {
      const rankedCandidates = context.wasmDecoders?.length ? [mocks.webCodecs, mocks.wasm] : [mocks.webCodecs]
      return {
        baseCandidates: rankedCandidates,
        adjustments: [],
        rankedCandidates,
        selection: { backend: mocks.webCodecs, intent, capabilities: context.snapshot, mediaCapabilities: context.media },
      }
    },
  }),
}))
vi.mock('@mx-player-max/decoder-wasm-vpx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mx-player-max/decoder-wasm-vpx')>()
  class FakeWorkerDecoder implements VideoDecoderAdapterLike {
    readonly decodeQueueSize = 0
    readonly configure = vi.fn(async () => undefined)
    readonly decode = vi.fn()
    readonly flush = vi.fn(async () => undefined)
    readonly reset = vi.fn(async () => undefined)
    readonly close = vi.fn()
    constructor(options: { callbacks: VideoDecoderAdapterCallbacks }) { mocks.createWorker(options) }
  }
  return {
    ...actual,
    createLibvpxVp8Plugin: (...args: Parameters<typeof actual.createLibvpxVp8Plugin>) => {
      mocks.createPlugin()
      return actual.createLibvpxVp8Plugin(...args)
    },
    WorkerLibvpxVp8DecoderAdapter: FakeWorkerDecoder,
  }
})

import { createMediaEngine } from '../src/index'

afterEach(() => {
  mocks.contexts.splice(0)
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('MediaEngine restricted WASM backend', () => {
  it('does not register a WASM declaration without explicit opt-in', async () => {
    const pipeline = new TestPipeline()
    const engine = createMediaEngine({ createCustomPipeline: (options) => pipeline.attach(options) })

    await engine.load(loadOptions())

    expect(mocks.contexts[0]?.wasmDecoders).toBeUndefined()
    expect(mocks.createPlugin).not.toHaveBeenCalled()
    expect(mocks.createWorker).not.toHaveBeenCalled()
    expect(engine.selection?.backend.kind).toBe('webcodecs')
    engine.close()
  })

  it('does not create or fetch a WASM decoder when WebCodecs commits first', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const pipeline = new TestPipeline()
    const engine = createMediaEngine({ createCustomPipeline: (options) => pipeline.attach(options) })

    await engine.load(loadOptions('https://assets.example.test/wasm/'))

    expect(mocks.contexts[0]?.wasmDecoders).toEqual([expect.objectContaining({ codec: 'vp8', supportsVideo: true, supportsAudio: false })])
    expect(mocks.createWorker).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(engine.decisionTrace?.attempts).toEqual([
      { index: 0, candidateId: 'webcodecs-custom', kind: 'webcodecs', status: 'selected', errorCode: null },
    ])
    engine.close()
  })

  it('closes a failed WebCodecs scope before atomically committing WASM', async () => {
    const order: string[] = []
    const pipelines: TestPipeline[] = []
    const engine = createMediaEngine({
      createCustomPipeline(options) {
        const pipeline = new TestPipeline(pipelines.length === 0, order)
        pipelines.push(pipeline)
        return pipeline.attach(options)
      },
    })

    await engine.load(loadOptions('https://assets.example.test/wasm'))

    expect(order).toEqual(['initialize:webcodecs', 'close:webcodecs', 'initialize:wasm'])
    expect(pipelines[0]?.options.callbacks.isActive()).toBe(false)
    expect(pipelines[1]?.options.dependencies).toEqual(expect.objectContaining({
      decoderConfig: { codec: 'vp8', codedWidth: 640, codedHeight: 360 },
      decoderConfigSupported: true,
      createDecoder: expect.any(Function),
    }))
    expect(mocks.createWorker).toHaveBeenCalledOnce()
    expect(engine.selection?.backend.kind).toBe('wasm')
    expect(engine.decisionTrace).toMatchObject({
      status: 'selected',
      selectedCandidateId: 'wasm-custom',
      attempts: [
        { candidateId: 'webcodecs-custom', status: 'failed', errorCode: 'CUSTOM_OPERATION_FAILED' },
        { candidateId: 'wasm-custom', status: 'selected', errorCode: null },
      ],
    })
    engine.close()
    expect(pipelines[1]?.close).toHaveBeenCalledOnce()
  })
})

class TestPipeline {
  readonly stats: CustomVideoStats = {
    decodedFrames: 0, deliveredFrames: 0, droppedFrames: 0, droppedStaleFrames: 0,
    droppedPreSeekFrames: 0, queuedFrames: 0, decodeQueueSize: 0, bufferedDuration: 0, endOfStream: false,
  }
  readonly audioStats: CustomAudioStats | null = null
  readonly audioClock: AudioClockSnapshot = {
    source: 'media-wall-clock', mediaTime: 0, contextTime: 0, renderedFrames: 0,
    sampleRate: 0, playbackRate: 1, running: false, underrun: false, epoch: 0,
  }
  readonly volume = 1
  readonly muted = false
  readonly playbackRate = 1
  readonly epoch = 0
  readonly close = vi.fn(() => { this.order?.push(`close:${this.label()}`) })
  readonly play = vi.fn(async () => undefined)
  readonly pause = vi.fn()
  readonly seek = vi.fn(async () => undefined)
  readonly setPlaybackRate = vi.fn()
  readonly setVolume = vi.fn()
  readonly setMuted = vi.fn()
  readonly readVideoFrame = vi.fn(async (): Promise<DecodedVideoFrame | null> => null)
  options!: CustomMediaPipelineOptions

  constructor(readonly fail = false, readonly order?: string[]) {}

  attach(options: CustomMediaPipelineOptions): CustomMediaPipeline {
    this.options = options
    return this as unknown as CustomMediaPipeline
  }

  async initialize(): Promise<void> {
    this.order?.push(`initialize:${this.label()}`)
    if (this.fail) throw new Error('WebCodecs initialization failed')
    this.options.dependencies?.createDecoder?.({ onFrame: vi.fn(), onError: vi.fn(), onDequeue: vi.fn() })
    this.options.callbacks.onEvent({ type: 'ready' })
  }

  label(): string { return this.options.dependencies?.decoderConfig ? 'wasm' : 'webcodecs' }
}

function loadOptions(wasmBaseUrl?: string) {
  return {
    target: new FakeVideo() as unknown as HTMLElement,
    source: { kind: 'file' as const, file: new Blob(['media']) as File },
    intent: 'frame-access' as const,
    ...(wasmBaseUrl === undefined ? {} : { wasmBaseUrl }),
  }
}
