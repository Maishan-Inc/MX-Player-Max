import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AudioClockSnapshot,
  CapabilitySnapshot,
  CustomAudioStats,
  CustomVideoStats,
  DecodedVideoFrame,
  MediaCapabilityReport,
  MediaDescriptor,
  PlaybackSelection,
  StrategyEvaluation,
} from '@mx-player-max/types'
import type { ManagedVideoRenderer } from '@mx-player-max/renderers'
import type { CustomMediaPipeline, CustomMediaPipelineOptions } from '../src/index'
import { FakeVideo } from './fake-video'

const media = createMedia()
const snapshot = createSnapshot()
const report = createReport()
const nativeCandidate = { id: 'native-html-video', kind: 'html-video', videoCodec: 'vp8', audioCodec: null, renderer: 'native', score: 100, reasons: ['native'], requires: ['HTMLVideoElement'] } as const
const customCandidate = { id: 'webcodecs-custom', kind: 'webcodecs', videoCodec: 'vp8', audioCodec: null, renderer: 'canvas2d', score: 90, reasons: ['custom'], requires: ['VideoDecoder'] } as const

const mocks = vi.hoisted(() => ({
  createRangeLoader: vi.fn(() => ({ close: vi.fn(), read: vi.fn() })),
  probeContainer: vi.fn(async () => ({
    adapter: {},
    metadata: { container: media.container, media, tracks: media.tracks, duration: media.duration, size: media.size, hasSeekIndex: true },
    demuxer: { close: vi.fn() },
  })),
  detectCapabilities: vi.fn(async () => snapshot),
  probeMediaCapabilities: vi.fn(async () => report),
  createStrategyEngine: vi.fn(() => ({
    evaluate: vi.fn((): StrategyEvaluation => ({
      baseCandidates: [nativeCandidate, customCandidate],
      adjustments: [],
      rankedCandidates: [nativeCandidate, customCandidate],
      selection: selection(nativeCandidate),
    })),
  })),
}))

vi.mock('@mx-player-max/demux', () => ({ createRangeLoader: mocks.createRangeLoader, probeContainer: mocks.probeContainer }))
vi.mock('@mx-player-max/capabilities', () => ({
  createCapabilityContext: (value: CapabilitySnapshot, mediaReport: MediaCapabilityReport) => ({ snapshot: value, media: mediaReport }),
  detectCapabilities: mocks.detectCapabilities,
  detectWasmCapabilities: async (value: CapabilitySnapshot) => value,
  probeMediaCapabilities: mocks.probeMediaCapabilities,
}))
vi.mock('@mx-player-max/platform', () => ({ createPlatformPolicy: () => ({ adjustScores: () => [] }) }))
vi.mock('@mx-player-max/strategy', () => ({ createStrategyEngine: mocks.createStrategyEngine }))

import { createMediaEngine } from '../src/index'

class FailingNativeVideo extends FakeVideo {
  override load(): void {
    this.order.push('load')
    this.error = { code: 3 }
    this.dispatch('error')
  }
}

class ReadyCustomPipeline {
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
  readonly close = vi.fn()
  readonly initialize = vi.fn(async () => { this.options.callbacks.onEvent({ type: 'ready' }) })
  readonly play = vi.fn(async () => { this.options.callbacks.onEvent({ type: 'playing' }) })
  readonly pause = vi.fn()
  readonly seek = vi.fn(async () => undefined)
  readonly setPlaybackRate = vi.fn()
  readonly setVolume = vi.fn()
  readonly setMuted = vi.fn()
  readonly readVideoFrame = vi.fn(async (): Promise<DecodedVideoFrame | null> => null)

  constructor(readonly options: CustomMediaPipelineOptions) {}
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('MediaEngine backend fallback', () => {
  it('cleans a failed Native attempt before atomically selecting WebCodecs', async () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:fallback'), revokeObjectURL: vi.fn() })
    const { container, children, videos } = createContainer()
    const renderer = createRenderer()
    let custom!: ReadyCustomPipeline
    const engine = createMediaEngine({
      createCustomPipeline(options) {
        custom = new ReadyCustomPipeline(options)
        return custom as unknown as CustomMediaPipeline
      },
      createRenderer: () => renderer,
    })
    const backendchange = vi.fn()
    const decisionchange = vi.fn()
    engine.on('backendchange', backendchange)
    engine.on('decisionchange', decisionchange)

    await engine.load({ target: container as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['media']) as File } })

    expect(videos).toHaveLength(2)
    expect(videos.every((video) => video.src === '' && video.parentNode === null)).toBe(true)
    expect(custom.initialize).toHaveBeenCalledOnce()
    expect(engine.selection?.backend.id).toBe('webcodecs-custom')
    expect(engine.state).toBe('ready')
    expect(engine.decisionTrace).toMatchObject({
      status: 'selected',
      selectedCandidateId: 'webcodecs-custom',
      attempts: [
        { candidateId: 'native-html-video', status: 'failed', errorCode: 'NATIVE_DECODE_FAILED' },
        { candidateId: 'webcodecs-custom', status: 'selected', errorCode: null },
      ],
    })
    expect(backendchange).toHaveBeenCalledTimes(1)
    expect(backendchange).toHaveBeenCalledWith({ previous: null, current: expect.objectContaining({ id: 'webcodecs-custom' }), reason: 'strategy-selection' })
    expect(decisionchange).toHaveBeenCalled()
    expect(children.map((child) => child.tagName)).toEqual(['CANVAS'])

    engine.close()
    expect(custom.close).toHaveBeenCalledOnce()
    expect(renderer.close).toHaveBeenCalledOnce()
    expect(children).toEqual([])
    expect(engine.decisionTrace?.status).toBe('closed')
  })

  it('removes every candidate surface when all verified backends fail', async () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:all-fail'), revokeObjectURL: vi.fn() })
    const { container, children, videos } = createContainer()
    const renderer = createRenderer(new Error('renderer attach failed with private detail'))
    let custom!: ReadyCustomPipeline
    const engine = createMediaEngine({
      createCustomPipeline(options) {
        custom = new ReadyCustomPipeline(options)
        return custom as unknown as CustomMediaPipeline
      },
      createRenderer: () => renderer,
    })
    const backendchange = vi.fn()
    engine.on('backendchange', backendchange)

    await expect(engine.load({ target: container as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['media']) as File } })).rejects.toMatchObject({
      code: 'STRATEGY_ALL_CANDIDATES_FAILED',
      failures: [
        { candidateId: 'native-html-video', errorCode: 'NATIVE_DECODE_FAILED' },
        { candidateId: 'webcodecs-custom', errorCode: 'CUSTOM_OPERATION_FAILED' },
      ],
    })

    expect(engine.selection).toBeNull()
    expect(engine.decisionTrace).toMatchObject({ status: 'failed', finalErrorCode: 'STRATEGY_ALL_CANDIDATES_FAILED' })
    expect(backendchange).not.toHaveBeenCalled()
    expect(custom.close).toHaveBeenCalledOnce()
    expect(renderer.close).toHaveBeenCalledOnce()
    expect(videos.every((video) => video.src === '' && video.parentNode === null)).toBe(true)
    expect(children).toEqual([])
    expect(JSON.stringify(engine.decisionTrace)).not.toContain('private detail')
    engine.close()
  })
})

function selection(backend: typeof nativeCandidate | typeof customCandidate): PlaybackSelection {
  return { backend, intent: 'normal', capabilities: snapshot, mediaCapabilities: report }
}

function createContainer(): {
  container: object
  children: Array<{ tagName: string; parentNode: object | null }>
  videos: FailingNativeVideo[]
} {
  const children: Array<{ tagName: string; parentNode: object | null }> = []
  const videos: FailingNativeVideo[] = []
  const parent = {
    removeChild(node: { tagName: string; parentNode: object | null }): void {
      const index = children.indexOf(node)
      if (index >= 0) children.splice(index, 1)
      node.parentNode = null
    },
    replaceChild(next: { tagName: string; parentNode: object | null }, previous: { tagName: string; parentNode: object | null }): void {
      const index = children.indexOf(previous)
      if (index >= 0) children[index] = next
      previous.parentNode = null
      next.parentNode = parent
    },
  }
  const document = {
    createElement(tag: string): FailingNativeVideo | { tagName: string; parentNode: object | null; width: number; height: number; clientWidth: number; clientHeight: number; style: object; getContext(): object } {
      if (tag === 'video') {
        const video = new FailingNativeVideo()
        video.ownerDocument = document as never
        videos.push(video)
        return video
      }
      if (tag === 'canvas') return { tagName: 'CANVAS', parentNode: null, width: 640, height: 360, clientWidth: 640, clientHeight: 360, style: {}, getContext: () => ({}) }
      throw new Error('unexpected element')
    },
  }
  const container = {
    tagName: 'DIV',
    ownerDocument: document,
    appendChild(node: { tagName: string; parentNode: object | null }) {
      children.push(node)
      node.parentNode = parent
      return node
    },
  }
  return { container, children, videos }
}

function createRenderer(attachError?: unknown): ManagedVideoRenderer {
  return {
    kind: 'canvas2d',
    state: 'ready',
    stats: {
      kind: 'canvas2d', state: 'ready', presentedFrames: 0, droppedFrames: 0, waitFrames: 0,
      invalidFrames: 0, fallbackCount: 0, width: 640, height: 360, devicePixelRatio: 1,
      colorMode: 'unknown', colorRange: 'unknown', hdrPreserved: false, hdrReason: 'hdr-not-confirmed', filter: 'none',
    },
    capabilities: {
      kind: 'canvas2d', available: true, filters: ['none'], maxTextureDimension2d: 16_384,
      externalTexture: false, hdr: false, lossRecovery: false,
    },
    attach: vi.fn(async () => { if (attachError !== undefined) throw attachError }),
    render: vi.fn(), resize: vi.fn(), setFilter: vi.fn(), setTransform: vi.fn(), noteSchedule: vi.fn(), close: vi.fn(),
  }
}

function createMedia(): MediaDescriptor {
  return {
    container: 'webm', duration: 1_000_000, size: 100, mimeType: 'video/webm',
    tracks: [{ id: 1, kind: 'video', codecId: 'V_VP8', codec: 'vp8', width: 640, height: 360, frameRate: 30 }],
  }
}

function createSnapshot(): CapabilitySnapshot {
  return {
    schemaVersion: 1, sdkVersion: 'test', browser: 'unknown', browserVersion: null, platform: 'unknown',
    crossOriginIsolated: false, sharedArrayBuffer: false, wasmSimd: false, wasmThreads: false,
    htmlVideo: true, mediaCapabilities: true, webCodecsVideo: true, webCodecsAudio: false,
    webGpu: false, webGl2: false, canvas2d: true, workerMediaSource: false,
    webGpuFeatures: { available: false, float32Filterable: false, shaderF16: false, maxComputeWorkgroupStorageSize: 0, maxTextureDimension2d: 0, maxBufferSize: 0, importExternalTexture: false, adapterVendor: null, adapterArchitecture: null, isFallbackAdapter: false },
    quirks: [],
  }
}

function createReport(): MediaCapabilityReport {
  return {
    schemaVersion: 1,
    query: { container: 'webm', mimeType: 'video/webm', video: { codec: 'vp8', codedWidth: 640, codedHeight: 360, framerate: 30 }, audio: null },
    native: {
      video: { status: 'supported', reasons: [], contentType: 'video/webm; codecs="vp8"', canPlayType: 'probably' },
      audio: { status: 'unknown', reasons: ['track-absent'], contentType: null, canPlayType: '' },
      playable: 'supported', reasons: [],
    },
    webCodecs: {
      video: { status: 'supported', reasons: [], configPresent: true },
      audio: { status: 'unknown', reasons: ['track-absent'], configPresent: false },
      playable: 'supported', reasons: [],
    },
  }
}
