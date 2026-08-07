import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CapabilitySnapshot,
  CustomVideoStats,
  DecodedVideoFrame,
  MediaCapabilityReport,
  PlaybackIntent,
  PlaybackSelection,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type { CustomMediaPipeline, CustomMediaPipelineOptions } from '../src/index'
import { FakeDocument, FakeVideo } from './fake-video'
import { createMedia, createReport, createSnapshot, fakeFrame } from './custom-fakes'

const mocks = vi.hoisted(() => {
  const closeReader = vi.fn()
  const closeDemuxer = vi.fn()
  const createRangeLoader = vi.fn(() => ({ close: closeReader, read: vi.fn() }))
  const probeContainer = vi.fn(async () => {
    const media = createMedia()
    return { adapter: {}, metadata: { container: media.container, media, tracks: media.tracks, duration: media.duration, size: media.size, hasSeekIndex: true }, demuxer: { close: closeDemuxer } }
  })
  const detectCapabilities = vi.fn(async (): Promise<CapabilitySnapshot> => createSnapshot())
  const probeMediaCapabilities = vi.fn(async (): Promise<MediaCapabilityReport> => createReport())
  let backendKind: 'html-video' | 'webcodecs' = 'webcodecs'
  const createStrategyEngine = vi.fn(() => ({
    select: vi.fn((_media, intent: PlaybackIntent): PlaybackSelection => {
      const report = createReport()
      return {
        backend: backendKind === 'webcodecs'
          ? { id: 'webcodecs-custom', kind: 'webcodecs', videoCodec: 'vp8', audioCodec: 'opus', renderer: 'canvas2d', score: 120, reasons: [], requires: ['VideoDecoder'] }
          : { id: 'native-html-video', kind: 'html-video', videoCodec: 'vp8', audioCodec: 'opus', renderer: 'native', score: 100, reasons: [], requires: ['HTMLVideoElement'] },
        intent,
        capabilities: createSnapshot(),
        mediaCapabilities: report,
      }
    }),
  }))
  return {
    closeReader, closeDemuxer, createRangeLoader, probeContainer, detectCapabilities, probeMediaCapabilities,
    createStrategyEngine,
    setBackend(value: 'html-video' | 'webcodecs') { backendKind = value },
  }
})

vi.mock('@mx-player-max/demux', () => ({ createRangeLoader: mocks.createRangeLoader, probeContainer: mocks.probeContainer }))
vi.mock('@mx-player-max/capabilities', () => ({
  createCapabilityContext: (snapshot: CapabilitySnapshot, media: MediaCapabilityReport) => ({ snapshot, media }),
  detectCapabilities: mocks.detectCapabilities,
  probeMediaCapabilities: mocks.probeMediaCapabilities,
}))
vi.mock('@mx-player-max/platform', () => ({ createPlatformPolicy: () => ({ adjustScores: () => [] }) }))
vi.mock('@mx-player-max/strategy', () => ({ createStrategyEngine: mocks.createStrategyEngine }))

import { createMediaEngine } from '../src/index'

const stats: CustomVideoStats = {
  decodedFrames: 1, deliveredFrames: 0, droppedFrames: 0, droppedStaleFrames: 0,
  droppedPreSeekFrames: 0, queuedFrames: 1, decodeQueueSize: 0, bufferedDuration: 33_333, endOfStream: false,
}

class FakeCustomPipeline {
  readonly stats = stats
  readonly close = vi.fn()
  readonly initialize = vi.fn(async () => { this.options.callbacks.onEvent({ type: 'ready' }) })
  readonly play = vi.fn(async () => { this.options.callbacks.onEvent({ type: 'playing' }) })
  readonly pause = vi.fn(() => { this.options.callbacks.onEvent({ type: 'paused' }) })
  readonly seek = vi.fn(async (_time: number) => {
    this.options.callbacks.onEvent({ type: 'seeking' })
    this.options.callbacks.onEvent({ type: 'seeked', resume: 'ready' })
  })
  readonly setPlaybackRate = vi.fn()
  readonly setVolume = vi.fn()
  readonly setMuted = vi.fn()
  readonly readVideoFrame = vi.fn(async (): Promise<DecodedVideoFrame | null> => {
    const frame = fakeFrame(0)
    return { frame: frame.frame, timestamp: 0, duration: 33_333, epoch: 0 }
  })

  constructor(readonly options: CustomMediaPipelineOptions) {}
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  mocks.setBackend('webcodecs')
})

describe('MediaEngine custom video integration', () => {
  it.each<PlaybackIntent>(['frame-access', 'filters', 'editing', 'ai-enhance'])('initializes WebCodecs for %s intent', async (intent) => {
    let custom!: FakeCustomPipeline
    const engine = createMediaEngine({ createCustomPipeline: (options) => {
      custom = new FakeCustomPipeline(options)
      return custom as unknown as CustomMediaPipeline
    } })
    const backendchange = vi.fn()
    engine.on('backendchange', backendchange)
    await engine.load({ target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File }, intent })
    expect(engine.state).toBe('ready')
    expect(engine.selection?.backend.kind).toBe('webcodecs')
    expect(engine.nativeFeatures).toBeNull()
    expect(engine.nativeStats).toBeNull()
    expect(engine.customVideoStats).toEqual(stats)
    expect(custom.initialize).toHaveBeenCalledOnce()
    expect(backendchange).toHaveBeenCalledOnce()
    engine.close()
  })

  it('proxies frame reads and custom controls without creating audio or renderer state', async () => {
    let custom!: FakeCustomPipeline
    const engine = createMediaEngine({ createCustomPipeline: (options) => {
      custom = new FakeCustomPipeline(options)
      return custom as unknown as CustomMediaPipeline
    } })
    await engine.load({ target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File }, intent: 'frame-access', autoplay: true })
    const frame = await engine.readVideoFrame()
    engine.pause()
    await engine.seek(100)
    engine.setPlaybackRate(2)
    engine.setVolume(0.5)
    engine.setMuted(true)
    expect(custom.play).toHaveBeenCalledOnce()
    expect(custom.pause).toHaveBeenCalledOnce()
    expect(custom.seek).toHaveBeenCalledWith(100)
    expect(frame?.timestamp).toBe(0)
    frame?.frame.close()
    await expect(engine.requestFullscreen()).rejects.toMatchObject({ code: ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED })
    await expect(engine.requestPictureInPicture()).rejects.toMatchObject({ code: ErrorCodes.NATIVE_PIP_UNSUPPORTED })
    engine.close()
  })

  it('removes only the unused engine-owned video when custom is selected', async () => {
    const document = new FakeDocument()
    const retained = { marker: 'caller-child' }
    const children: unknown[] = [retained]
    const removeChild = vi.fn((node: unknown) => {
      const index = children.indexOf(node)
      if (index >= 0) children.splice(index, 1)
    })
    const container = {
      ownerDocument: document,
      tagName: 'DIV',
      appendChild(node: unknown) {
        children.push(node)
        ;(node as { parentNode?: unknown }).parentNode = { removeChild }
        return node
      },
    }
    const engine = createMediaEngine({ createCustomPipeline: (options) => new FakeCustomPipeline(options) as unknown as CustomMediaPipeline })
    await engine.load({ target: container as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File }, intent: 'frame-access' })
    expect(children).toEqual([retained])
    expect(removeChild).toHaveBeenCalledOnce()
    engine.close()
  })

  it('does not claim full playback when normal or low-power selects WebCodecs', async () => {
    const createCustomPipeline = vi.fn()
    for (const intent of ['normal', 'low-power'] as const) {
      const engine = createMediaEngine({ createCustomPipeline })
      await expect(engine.load({ target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File }, intent })).rejects.toMatchObject({ code: ErrorCodes.CUSTOM_BACKEND_UNAVAILABLE })
      expect(createCustomPipeline).not.toHaveBeenCalled()
      engine.close()
    }
  })

  it('keeps custom HTTP headers inside the Phase 2 Range path', async () => {
    const engine = createMediaEngine({ createCustomPipeline: (options) => new FakeCustomPipeline(options) as unknown as CustomMediaPipeline })
    const source = { kind: 'url' as const, url: 'https://media.example.test/object', headers: { Authorization: 'private' } }
    await engine.load({ target: new FakeVideo() as unknown as HTMLElement, source, intent: 'frame-access' })
    expect(mocks.createRangeLoader).toHaveBeenCalledWith(source)
    engine.close()
  })

  it('keeps the Phase 3 native path and rejects native frame access explicitly', async () => {
    mocks.setBackend('html-video')
    const report = createReport()
    report.native.playable = 'supported'
    report.native.video = { status: 'supported', reasons: [], contentType: 'video/webm; codecs="vp8, opus"', canPlayType: 'probably' }
    report.native.audio = { ...report.native.video }
    mocks.probeMediaCapabilities.mockResolvedValueOnce(report)
    const video = new FakeVideo()
    const engine = createMediaEngine()
    await engine.load({ target: video as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File } })
    expect(engine.nativeFeatures).not.toBeNull()
    expect(engine.customVideoStats).toBeNull()
    await expect(engine.readVideoFrame()).rejects.toMatchObject({ code: ErrorCodes.CUSTOM_FRAME_ACCESS_UNAVAILABLE })
    engine.close()
  })

  it('reports a native to WebCodecs backend change on source replacement', async () => {
    mocks.setBackend('html-video')
    const nativeReport = createReport()
    nativeReport.native.playable = 'supported'
    nativeReport.native.video = { status: 'supported', reasons: [], contentType: 'video/webm; codecs="vp8, opus"', canPlayType: 'probably' }
    nativeReport.native.audio = { ...nativeReport.native.video }
    mocks.probeMediaCapabilities.mockResolvedValueOnce(nativeReport)
    const engine = createMediaEngine({ createCustomPipeline: (options) => new FakeCustomPipeline(options) as unknown as CustomMediaPipeline })
    const changes: Array<{ previous: string | null; current: string }> = []
    engine.on('backendchange', ({ previous, current }) => changes.push({ previous: previous?.kind ?? null, current: current.kind }))
    await engine.load({ target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['one']) as File } })
    mocks.setBackend('webcodecs')
    await engine.load({ target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['two']) as File }, intent: 'frame-access' })
    expect(changes).toEqual([
      { previous: null, current: 'html-video' },
      { previous: 'html-video', current: 'webcodecs' },
    ])
    engine.close()
  })

  it('closes the old custom pipeline on source replacement and emits no events after close', async () => {
    const created: FakeCustomPipeline[] = []
    const engine = createMediaEngine({ createCustomPipeline: (options) => {
      const value = new FakeCustomPipeline(options)
      created.push(value)
      return value as unknown as CustomMediaPipeline
    } })
    const statechange = vi.fn()
    engine.on('statechange', statechange)
    const loadOptions = { target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'file' as const, file: new Blob(['x']) as File }, intent: 'frame-access' as const }
    await engine.load(loadOptions)
    await engine.load(loadOptions)
    expect(created[0]?.close).toHaveBeenCalledOnce()
    engine.close()
    const calls = statechange.mock.calls.length
    created[1]?.options.callbacks.onEvent({ type: 'playing' })
    expect(statechange).toHaveBeenCalledTimes(calls)
    expect(created[1]?.close).toHaveBeenCalledOnce()
  })
})
