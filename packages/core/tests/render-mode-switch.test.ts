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
    metadata: { container: 'webm', media, tracks: media.tracks, duration: media.duration, size: media.size, hasSeekIndex: true },
    demuxer: { close: vi.fn() },
  })),
  detectCapabilities: vi.fn(async () => snapshot),
  probeMediaCapabilities: vi.fn(async () => report),
  evaluate: vi.fn(),
}))

vi.mock('@mx-player-max/demux', () => ({ createRangeLoader: mocks.createRangeLoader, probeContainer: mocks.probeContainer }))
vi.mock('@mx-player-max/capabilities', () => ({
  createCapabilityContext: (value: CapabilitySnapshot, mediaReport: MediaCapabilityReport) => ({ snapshot: value, media: mediaReport }),
  detectCapabilities: mocks.detectCapabilities,
  detectWasmCapabilities: async (value: CapabilitySnapshot) => value,
  probeMediaCapabilities: mocks.probeMediaCapabilities,
}))
vi.mock('@mx-player-max/platform', () => ({ createPlatformPolicy: () => ({ adjustScores: () => [] }) }))
vi.mock('@mx-player-max/strategy', () => ({ createStrategyEngine: () => ({ evaluate: mocks.evaluate }) }))

import { createMediaEngine } from '../src/index'

/**
 * The real strategy ranks the native candidate only for the native intents, which is exactly the
 * gate a render-mode switch has to move across, so the fake mirrors that rather than always
 * returning both candidates.
 */
function rankByIntent(intent: string): StrategyEvaluation {
  const nativeIntent = intent === 'normal' || intent === 'low-power'
  const ranked = nativeIntent ? [nativeCandidate] : [customCandidate]
  return {
    baseCandidates: ranked,
    adjustments: [],
    rankedCandidates: ranked,
    selection: { backend: ranked[0]!, intent: intent as PlaybackSelection['intent'], capabilities: snapshot, mediaCapabilities: report },
  }
}

class ReadyCustomPipeline {
  readonly stats: CustomVideoStats = {
    decodedFrames: 0, deliveredFrames: 0, droppedFrames: 0, droppedStaleFrames: 0,
    droppedPreSeekFrames: 0, queuedFrames: 0, decodeQueueSize: 0, bufferedDuration: 0, endOfStream: false,
  }
  readonly audioStats: CustomAudioStats | null = null
  audioClock: AudioClockSnapshot = {
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
  readonly seek = vi.fn(async (time: number) => {
    this.audioClock = { ...this.audioClock, mediaTime: time }
    this.options.callbacks.onEvent({ type: 'seeked', time })
  })
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

/**
 * Phase 6 chose a pipeline only at load time, so a host that wanted a filter -- or wanted to leave
 * the custom path -- had to call `load()` again and the viewer lost their position and their sidecar
 * subtitle tracks. These cases pin what the engine now carries across a switch.
 */
describe('MediaEngine render-mode switching', () => {
  it('moves a playing Native session onto the custom pipeline without losing position', async () => {
    mocks.evaluate.mockImplementation((_media: unknown, intent: string) => rankByIntent(intent))
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:switch'), revokeObjectURL: vi.fn() })
    const { container, children, videos } = createContainer()
    const renderer = createRenderer()
    let custom!: ReadyCustomPipeline
    const engine = createMediaEngine({
      createCustomPipeline(options) { custom = new ReadyCustomPipeline(options); return custom as unknown as CustomMediaPipeline },
      createRenderer: () => renderer,
    })

    await engine.load({ target: container as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['media']) as File } })
    expect(engine.selection?.backend.kind).toBe('html-video')
    expect(engine.rendererKind).toBeNull()

    await engine.play()
    const video = videos.at(-1)!
    video.currentTime = 1.25
    video.dispatch('timeupdate')
    const epochBefore = engine.playback.sessionEpoch
    const positionBefore = engine.playback.currentTime

    await engine.switchRenderMode({ pipeline: 'custom' })

    expect(engine.selection?.backend.kind).toBe('webcodecs')
    expect(engine.rendererKind).toBe('canvas2d')
    // A rebuild is a new session for every epoch-keyed consumer, so the epoch must move forward.
    expect(engine.playback.sessionEpoch).toBeGreaterThan(epochBefore)
    // Position is carried across by seeking the new pipeline to where the old one was.
    expect(custom.seek).toHaveBeenCalledWith(positionBefore)
    expect(engine.playback.currentTime).toBe(positionBefore)
    // It was playing, so it keeps playing.
    expect(custom.play).toHaveBeenCalled()
    expect(engine.playback.state).toBe('playing')
    // The Native surface is gone rather than left behind the canvas.
    expect(children.map((child) => child.tagName)).toEqual(['CANVAS'])

    engine.close()
  })

  it('moves a custom session back onto the Native path', async () => {
    mocks.evaluate.mockImplementation((_media: unknown, intent: string) => rankByIntent(intent))
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:back'), revokeObjectURL: vi.fn() })
    const { container, children } = createContainer()
    const engine = createMediaEngine({
      createCustomPipeline: (options) => new ReadyCustomPipeline(options) as unknown as CustomMediaPipeline,
      createRenderer: () => createRenderer(),
    })

    await engine.load({ target: container as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['media']) as File }, intent: 'filters' })
    expect(engine.selection?.backend.kind).toBe('webcodecs')
    const epochBefore = engine.playback.sessionEpoch

    await engine.switchRenderMode({ pipeline: 'native' })

    expect(engine.selection?.backend.kind).toBe('html-video')
    expect(engine.rendererKind).toBeNull()
    expect(engine.playback.sessionEpoch).toBeGreaterThan(epochBefore)
    expect(children.map((child) => child.tagName)).toEqual(['VIDEO'])

    engine.close()
  })

  /** Switching to the pipeline already in use would otherwise rebuild for nothing. */
  it('does nothing when the requested pipeline is already active', async () => {
    mocks.evaluate.mockImplementation((_media: unknown, intent: string) => rankByIntent(intent))
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:noop'), revokeObjectURL: vi.fn() })
    const { container } = createContainer()
    const engine = createMediaEngine({
      createCustomPipeline: (options) => new ReadyCustomPipeline(options) as unknown as CustomMediaPipeline,
      createRenderer: () => createRenderer(),
    })

    await engine.load({ target: container as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['media']) as File } })
    const epochBefore = engine.playback.sessionEpoch

    await engine.switchRenderMode({ pipeline: 'native' })

    expect(engine.playback.sessionEpoch).toBe(epochBefore)
    engine.close()
  })

  it('rejects a switch when nothing is loaded', async () => {
    const engine = createMediaEngine({
      createCustomPipeline: (options) => new ReadyCustomPipeline(options) as unknown as CustomMediaPipeline,
      createRenderer: () => createRenderer(),
    })
    await expect(engine.switchRenderMode({ pipeline: 'custom' })).rejects.toMatchObject({ code: 'RENDERER_BACKEND_UNAVAILABLE' })
    engine.close()
  })

  /**
   * A switch that cannot reach the requested pipeline has to leave the viewer with the session they
   * were watching. Restoring the previous options and reloading is what makes the failure survivable
   * rather than leaving the player with nothing loaded.
   */
  it('restores the previous session when the switch fails', async () => {
    mocks.evaluate.mockImplementation((_media: unknown, intent: string) => rankByIntent(intent))
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:rollback'), revokeObjectURL: vi.fn() })
    const { container } = createContainer()
    let attempts = 0
    const engine = createMediaEngine({
      createCustomPipeline: (options) => new ReadyCustomPipeline(options) as unknown as CustomMediaPipeline,
      createRenderer: () => {
        attempts += 1
        // The first renderer is for the initial custom load; the switch target is the one that fails.
        return createRenderer(attempts > 1 ? new Error('renderer attach failed') : undefined)
      },
    })

    await engine.load({ target: container as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['media']) as File }, intent: 'filters' })
    expect(engine.selection?.backend.kind).toBe('webcodecs')

    // Ask to go native, then back to custom: the custom rebuild cannot attach a renderer.
    await engine.switchRenderMode({ pipeline: 'native' })
    await expect(engine.switchRenderMode({ pipeline: 'custom' })).rejects.toBeDefined()

    // The rollback reloads the options the session had before the failed switch.
    expect(engine.selection?.backend.kind).toBe('html-video')
    expect(engine.state).toBe('ready')

    engine.close()
  })
})

function createContainer(): {
  container: object
  children: Array<{ tagName: string; parentNode: object | null }>
  videos: FakeVideo[]
} {
  const children: Array<{ tagName: string; parentNode: object | null }> = []
  const videos: FakeVideo[] = []
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
    createElement(tag: string): unknown {
      if (tag === 'video') {
        const video = new FakeVideo()
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
    container: 'webm', duration: 10_000_000, size: 100, mimeType: 'video/webm',
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
