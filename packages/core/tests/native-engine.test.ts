import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapabilitySnapshot, MediaCapabilityReport, MediaDescriptor, PlaybackSelection } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { FakeVideo } from './fake-video'

const mocks = vi.hoisted(() => {
  const closeDemuxer = vi.fn()
  const closeReader = vi.fn()
  const createRangeLoader = vi.fn(() => ({ close: closeReader, read: vi.fn(async () => ({ data: new Uint8Array(), sourceLength: null, contentRange: null, etag: null })) }))
  const probeContainer = vi.fn(async () => ({ adapter: {}, metadata: { container: 'mp4', media: createMedia(), tracks: createMedia().tracks, duration: 10_000_000, size: 100, hasSeekIndex: true }, demuxer: { close: closeDemuxer } }))
  const detectCapabilities = vi.fn(async (): Promise<CapabilitySnapshot> => createSnapshot())
  const probeMediaCapabilities = vi.fn(async (): Promise<MediaCapabilityReport> => createReport())
  const createPlatformPolicy = vi.fn(() => ({ adjustScores: () => [] }))
  const createStrategyEngine = vi.fn(() => ({ select: vi.fn((): PlaybackSelection => ({ backend: { id: 'native-html-video', kind: 'html-video', videoCodec: 'avc1.640028', audioCodec: 'mp4a.40.2', renderer: 'native', score: 100, reasons: [], requires: [] }, intent: 'normal', capabilities: createSnapshot(), mediaCapabilities: createReport() })) }))
  return { closeDemuxer, closeReader, createRangeLoader, probeContainer, detectCapabilities, probeMediaCapabilities, createPlatformPolicy, createStrategyEngine }
})

vi.mock('@mx-player-max/demux', () => ({ createRangeLoader: mocks.createRangeLoader, probeContainer: mocks.probeContainer }))
vi.mock('@mx-player-max/capabilities', () => ({ createCapabilityContext: (snapshot: CapabilitySnapshot, media: MediaCapabilityReport) => ({ snapshot, media }), detectCapabilities: mocks.detectCapabilities, probeMediaCapabilities: mocks.probeMediaCapabilities }))
vi.mock('@mx-player-max/platform', () => ({ createPlatformPolicy: mocks.createPlatformPolicy }))
vi.mock('@mx-player-max/strategy', () => ({ createStrategyEngine: mocks.createStrategyEngine }))

import { createMediaEngine } from '../src/index'

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('MediaEngine native load orchestration', () => {
  it('probes Phase 2 input, chooses native and forwards media lifecycle events', async () => {
    const video = new FakeVideo()
    const engine = createMediaEngine()
    const ready = vi.fn()
    engine.on('ready', ready)
    await engine.load({ target: video as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File } })
    expect(mocks.createRangeLoader).toHaveBeenCalledOnce()
    expect(mocks.closeDemuxer).toHaveBeenCalledOnce()
    expect(mocks.closeReader).toHaveBeenCalledOnce()
    expect(engine.media?.container).toBe('mp4')
    expect(engine.selection?.backend.kind).toBe('html-video')
    expect(engine.state).toBe('ready')
    expect(ready).toHaveBeenCalledOnce()
    video.dispatch('timeupdate')
    expect(engine.state).toBe('ready')
    engine.close()
    expect(engine.state).toBe('closed')
  })

  it('publishes native element seconds as microsecond playback snapshots', async () => {
    const video = new FakeVideo()
    const engine = createMediaEngine()
    await engine.load({ target: video as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File } })
    video.currentTime = 1.25
    video.duration = 12.5
    video.playedRanges = [{ start: 0, end: 1.25 }]
    video.bufferedRanges = [{ start: 0, end: 4 }]

    video.dispatch('timeupdate')
    video.dispatch('progress')

    expect(engine.playback).toMatchObject({
      currentTime: 1_250_000,
      duration: 12_500_000,
      played: [{ start: 0, end: 1_250_000 }],
      buffered: [{ start: 0, end: 4_000_000 }],
      bufferedAhead: 2_750_000,
    })
    engine.close()
  })

  it('tracks native Picture-in-Picture presentation events in the public snapshot', async () => {
    const video = new FakeVideo()
    const engine = createMediaEngine()
    await engine.load({ target: video as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File } })
    video.dispatch('enterpictureinpicture')
    expect(engine.playback.presentationMode).toBe('picture-in-picture')
    video.dispatch('leavepictureinpicture')
    expect(engine.playback.presentationMode).toBe('inline')
    engine.close()
  })

  it('does not silently ignore custom remote headers', async () => {
    const engine = createMediaEngine()
    await expect(engine.load({ target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'url', url: 'https://example.test/video.mp4', headers: { Authorization: 'secret' } } })).rejects.toMatchObject({
      code: ErrorCodes.STRATEGY_ALL_CANDIDATES_FAILED,
      failures: [{ candidateId: 'native-html-video', errorCode: ErrorCodes.NATIVE_CUSTOM_HEADERS_UNSUPPORTED }],
    })
    expect(mocks.createRangeLoader).toHaveBeenCalledOnce()
  })

  it('rejects unsafe URL protocols and every operation after close', async () => {
    const engine = createMediaEngine()
    await expect(engine.load({ target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'url', url: 'data:text/plain,media' } })).rejects.toMatchObject({ code: ErrorCodes.NATIVE_SOURCE_INVALID })
    engine.close()
    await expect(engine.play()).rejects.toMatchObject({ code: ErrorCodes.ENGINE_CLOSED })
    expect(() => engine.pause()).toThrowError(expect.objectContaining({ code: ErrorCodes.ENGINE_CLOSED }))
  })

  it.each([
    [ErrorCodes.RANGE_CORS_FAILED, ErrorCodes.NATIVE_CORS_FAILED],
    [ErrorCodes.RANGE_NETWORK_FAILED, ErrorCodes.NATIVE_NETWORK_FAILED],
    [ErrorCodes.RANGE_ABORTED, ErrorCodes.NATIVE_ABORTED],
  ])('maps %s probe failures to %s', async (inputCode, outputCode) => {
    mocks.probeContainer.mockRejectedValueOnce({ code: inputCode, message: 'private probe detail', recoverable: true })
    const engine = createMediaEngine()
    await expect(engine.load({ target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'url', url: 'https://media.example.test/video' } })).rejects.toMatchObject({ code: outputCode })
    expect(mocks.closeReader).toHaveBeenCalledOnce()
  })

  it('reports a sanitized aggregate when the only selected backend cannot initialize', async () => {
    mocks.createStrategyEngine.mockReturnValueOnce({ select: vi.fn(() => ({
      backend: { id: 'webcodecs-custom', kind: 'webcodecs', videoCodec: 'avc1.640028', audioCodec: 'mp4a.40.2', renderer: 'canvas2d', score: 100, reasons: [], requires: [] },
      intent: 'normal', capabilities: createSnapshot(), mediaCapabilities: createReport(),
    })) })
    const engine = createMediaEngine()
    await expect(engine.load({ target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File } })).rejects.toMatchObject({
      code: ErrorCodes.STRATEGY_ALL_CANDIDATES_FAILED,
      failures: [{ candidateId: 'webcodecs-custom', errorCode: ErrorCodes.WEBCODECS_NOT_SUPPORTED }],
    })
    expect(engine.nativeFeatures).toBeNull()
  })

  it('reports unknown or unsupported codec combinations as native not supported', async () => {
    mocks.createStrategyEngine.mockReturnValueOnce({ select: vi.fn(() => { throw { code: ErrorCodes.STRATEGY_NO_VIABLE_BACKEND, message: 'none', recoverable: false } }) })
    const engine = createMediaEngine()
    await expect(engine.load({ target: new FakeVideo() as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['unknown']) as File } })).rejects.toMatchObject({ code: ErrorCodes.NATIVE_NOT_SUPPORTED })
  })

  it('keeps loaded media ready when autoplay is blocked', async () => {
    const video = new FakeVideo()
    video.playReject = Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
    const engine = createMediaEngine()
    await expect(engine.load({ target: video as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File }, autoplay: true })).rejects.toMatchObject({ code: ErrorCodes.NATIVE_AUTOPLAY_BLOCKED })
    expect(engine.state).toBe('ready')
    expect(engine.media).not.toBeNull()
    expect(engine.nativeFeatures).not.toBeNull()
    engine.close()
  })

  it('implements stable on/off/once listener behavior', async () => {
    const video = new FakeVideo()
    const engine = createMediaEngine()
    await engine.load({ target: video as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['x']) as File } })
    const onListener = vi.fn()
    const onceListener = vi.fn()
    const unsubscribe = engine.on('timeupdate', onListener)
    engine.once('timeupdate', onceListener)
    video.currentTime = 1
    video.dispatch('timeupdate')
    video.currentTime = 2
    video.dispatch('timeupdate')
    unsubscribe()
    video.dispatch('timeupdate')
    expect(onListener).toHaveBeenCalledTimes(2)
    expect(onceListener).toHaveBeenCalledOnce()
    engine.close()
  })

  it('fully cleans the old pipeline when load replaces the source', async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const first = new FakeVideo()
    const second = new FakeVideo()
    const engine = createMediaEngine()
    await engine.load({ target: first as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['one']) as File } })
    await engine.load({ target: second as unknown as HTMLElement, source: { kind: 'file', file: new Blob(['two']) as File } })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first')
    expect(first.src).toBe('')
    engine.close()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second')
  })
})

function createMedia(): MediaDescriptor {
  return { container: 'mp4', duration: 10_000_000, size: 100, mimeType: 'video/mp4', tracks: [
    { id: 1, kind: 'video', codecId: 'avc1', codec: 'avc1.640028', width: 1920, height: 1080, frameRate: 30 },
    { id: 2, kind: 'audio', codecId: 'aac', codec: 'mp4a.40.2', sampleRate: 48_000, channels: 2 },
  ] }
}

function createSnapshot(): CapabilitySnapshot {
  return { schemaVersion: 1, sdkVersion: 'test', browser: 'unknown', browserVersion: null, platform: 'unknown', crossOriginIsolated: false, sharedArrayBuffer: false, wasmSimd: false, wasmThreads: false, htmlVideo: true, mediaCapabilities: false, webCodecsVideo: false, webCodecsAudio: false, webGpu: false, webGl2: false, canvas2d: false, workerMediaSource: false, webGpuFeatures: { available: false, float32Filterable: false, shaderF16: false, maxComputeWorkgroupStorageSize: 0, maxTextureDimension2d: 0, maxBufferSize: 0, importExternalTexture: false, adapterVendor: null, adapterArchitecture: null, isFallbackAdapter: false }, quirks: [] }
}

function createReport(): MediaCapabilityReport {
  return { schemaVersion: 1, query: { container: 'mp4', mimeType: 'video/mp4', video: { codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080 }, audio: { codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2 } }, native: { video: { status: 'supported', reasons: [], contentType: 'video/mp4; codecs="avc1.640028, mp4a.40.2"', canPlayType: 'probably' }, audio: { status: 'supported', reasons: [], contentType: 'video/mp4; codecs="avc1.640028, mp4a.40.2"', canPlayType: 'probably' }, playable: 'supported', reasons: [] }, webCodecs: { video: { status: 'unsupported', reasons: [], configPresent: true }, audio: { status: 'unsupported', reasons: [], configPresent: true }, playable: 'unsupported', reasons: [] } }
}
