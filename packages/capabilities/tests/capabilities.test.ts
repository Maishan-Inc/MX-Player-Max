import { describe, expect, it, vi } from 'vitest'
import type { CapabilitySnapshot, MediaDescriptor, WebGpuFeatureSnapshot } from '@mx-player-max/types'
import {
  CAPABILITY_SCHEMA_VERSION,
  createDefaultProbeAdapter,
  detectCapabilities,
  probeMediaCapabilities,
  type CapabilityCache,
  type CapabilityProbeAdapter,
} from '../src/index'

const noGpu: WebGpuFeatureSnapshot = {
  available: false,
  float32Filterable: false,
  shaderF16: false,
  maxComputeWorkgroupStorageSize: 0,
  maxTextureDimension2d: 0,
  maxBufferSize: 0,
  importExternalTexture: false,
  adapterVendor: null,
  adapterArchitecture: null,
  isFallbackAdapter: false,
}

function createAdapter(overrides: Partial<CapabilityProbeAdapter> = {}): CapabilityProbeAdapter {
  return {
    getUserAgent: () => '',
    getPlatform: () => '',
    isCrossOriginIsolated: () => false,
    hasSharedArrayBuffer: () => false,
    hasHtmlVideo: () => false,
    hasMediaCapabilities: () => false,
    hasVideoDecoder: () => false,
    hasAudioDecoder: () => false,
    hasWebGl2: () => false,
    hasCanvas2d: () => false,
    hasWorkerMediaSource: () => false,
    probeWasmSimd: () => false,
    probeWasmThreads: () => false,
    probeWebGpu: async () => noGpu,
    canPlayType: () => '',
    decodingInfo: async () => ({ supported: false, smooth: false, powerEfficient: false }),
    isVideoConfigSupported: async () => false,
    isAudioConfigSupported: async () => false,
    ...overrides,
  }
}

function createMedia(): MediaDescriptor {
  return {
    container: 'mp4',
    duration: 10_000_000,
    size: 1024,
    mimeType: 'video/mp4',
    tracks: [
      { id: 1, kind: 'video', codecId: 'avc', codec: 'avc1.640028', width: 1920, height: 1080, frameRate: 30, bitrate: 5_000_000 },
      { id: 2, kind: 'audio', codecId: 'aac', codec: 'mp4a.40.2', sampleRate: 48_000, channels: 2 },
    ],
  }
}

class MemoryCache implements CapabilityCache {
  readonly values = new Map<string, unknown>()

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value)
  }
}

describe('detectCapabilities', () => {
  it('does not fetch media or construct decoders through the default adapter', async () => {
    const fetchSpy = vi.fn()
    const videoDecoderConstructor = vi.fn()
    const audioDecoderConstructor = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('VideoDecoder', videoDecoderConstructor)
    vi.stubGlobal('AudioDecoder', audioDecoderConstructor)

    await detectCapabilities({
      adapter: createDefaultProbeAdapter(),
      cache: new MemoryCache(),
      sdkVersion: 'test-zero-side-effects',
      forceRefresh: true,
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(videoDecoderConstructor).not.toHaveBeenCalled()
    expect(audioDecoderConstructor).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('returns a complete fallback snapshot when browser APIs are absent', async () => {
    const snapshot = await detectCapabilities({
      adapter: createAdapter(),
      cache: new MemoryCache(),
      sdkVersion: 'test-fallback',
    })

    expect(snapshot).toEqual({
      schemaVersion: CAPABILITY_SCHEMA_VERSION,
      sdkVersion: 'test-fallback',
      browser: 'unknown',
      browserVersion: null,
      platform: 'unknown',
      crossOriginIsolated: false,
      sharedArrayBuffer: false,
      wasmSimd: false,
      wasmThreads: false,
      htmlVideo: false,
      mediaCapabilities: false,
      webCodecsVideo: false,
      webCodecsAudio: false,
      webGpu: false,
      webGl2: false,
      canvas2d: false,
      workerMediaSource: false,
      webGpuFeatures: noGpu,
      quirks: [],
    })
  })

  it('normalizes browser version and operating system without preserving raw UA', async () => {
    const snapshot = await detectCapabilities({
      adapter: createAdapter({
        getUserAgent: () => 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15',
        getPlatform: () => 'MacIntel',
      }),
      cache: new MemoryCache(),
      sdkVersion: 'test-webkit',
    })

    expect(snapshot.browser).toBe('webkit')
    expect(snapshot.browserVersion).toBe('18')
    expect(snapshot.platform).toBe('macos')
    expect(JSON.stringify(snapshot)).not.toContain('Mozilla')
  })

  it('never reports WASM threads outside a cross-origin isolated context', async () => {
    const threadProbe = vi.fn(() => true)
    const snapshot = await detectCapabilities({
      adapter: createAdapter({
        hasSharedArrayBuffer: () => true,
        probeWasmThreads: threadProbe,
      }),
      cache: new MemoryCache(),
      sdkVersion: 'test-non-isolated',
    })

    expect(snapshot.wasmThreads).toBe(false)
    expect(threadProbe).not.toHaveBeenCalled()
  })

  it('records successful inline SIMD and isolated thread feature probes', async () => {
    const snapshot = await detectCapabilities({
      adapter: createAdapter({
        isCrossOriginIsolated: () => true,
        hasSharedArrayBuffer: () => true,
        probeWasmSimd: () => true,
        probeWasmThreads: () => true,
      }),
      cache: new MemoryCache(),
      sdkVersion: 'test-isolated-wasm',
    })

    expect(snapshot.wasmSimd).toBe(true)
    expect(snapshot.wasmThreads).toBe(true)
  })

  it('caches, force-refreshes, and de-duplicates concurrent probes', async () => {
    const cache = new MemoryCache()
    let gpuCalls = 0
    const adapter = createAdapter({
      probeWebGpu: async () => {
        gpuCalls += 1
        await Promise.resolve()
        return noGpu
      },
    })
    const options = { adapter, cache, sdkVersion: 'test-cache' }

    const [first, concurrent] = await Promise.all([
      detectCapabilities(options),
      detectCapabilities(options),
    ])
    const cached = await detectCapabilities(options)
    const refreshed = await detectCapabilities({ ...options, forceRefresh: true })

    expect(first).toEqual(concurrent)
    expect(cached).toEqual(first)
    expect(refreshed).toEqual(first)
    expect(gpuCalls).toBe(2)
  })

  it('does not let callers mutate cached snapshots', async () => {
    const cache = new MemoryCache()
    const options = { adapter: createAdapter(), cache, sdkVersion: 'test-cache-clone' }
    const first = await detectCapabilities(options)
    first.quirks.push('caller-mutation')
    first.webGpuFeatures.available = true

    const second = await detectCapabilities(options)

    expect(second.quirks).toEqual([])
    expect(second.webGpuFeatures.available).toBe(false)
  })

  it('ignores malformed or throwing cache entries', async () => {
    const probe = vi.fn(async () => noGpu)
    const cache: CapabilityCache = {
      get: () => ({ schemaVersion: CAPABILITY_SCHEMA_VERSION }),
      set: () => { throw new Error('storage unavailable') },
    }

    const snapshot = await detectCapabilities({
      adapter: createAdapter({ probeWebGpu: probe }),
      cache,
      sdkVersion: 'test-malformed-cache',
    })

    expect(snapshot.sdkVersion).toBe('test-malformed-cache')
    expect(probe).toHaveBeenCalledOnce()
  })

  it('rejects partially valid snapshot cache entries', async () => {
    const probe = vi.fn(async () => noGpu)
    const cache: CapabilityCache = {
      get: () => ({
        schemaVersion: CAPABILITY_SCHEMA_VERSION,
        sdkVersion: 'bad',
        browser: 'unknown',
        browserVersion: null,
        platform: 'unknown',
        webGpuFeatures: { available: true },
      }),
      set: () => {},
    }

    await detectCapabilities({ adapter: createAdapter({ probeWebGpu: probe }), cache, sdkVersion: 'test-partial-cache' })

    expect(probe).toHaveBeenCalledOnce()
  })
})

describe('probeMediaCapabilities', () => {
  it('derives a real H.264 RFC 6381 query from compatible avcC metadata', async () => {
    const media = createMedia()
    const video = media.tracks.find((track) => track.kind === 'video')
    if (!video) throw new Error('missing fixture video')
    video.codec = 'avc1'
    video.codecId = 'V_MPEG4/ISO/AVC'
    video.codecPrivate = Uint8Array.of(1, 0x64, 0, 0x28, 0xff, 0xe1, 0).buffer
    const videoProbe = vi.fn(async () => true)
    const adapter = createAdapter({ hasVideoDecoder: () => true, hasAudioDecoder: () => true, isVideoConfigSupported: videoProbe, isAudioConfigSupported: async () => true })
    const cache = new MemoryCache()
    const snapshot = await detectCapabilities({ adapter, cache, sdkVersion: 'test-avcc-query' })
    const report = await probeMediaCapabilities(media, { adapter, cache, snapshot, sdkVersion: 'test-avcc-query' })
    expect(report.query.video?.codec).toBe('avc1.640028')
    expect(videoProbe).toHaveBeenCalledWith(expect.objectContaining({ codec: 'avc1.640028', description: video.codecPrivate }))
  })

  it('reports concrete native and WebCodecs support', async () => {
    const decodingInfo = vi.fn(async () => ({ supported: true, smooth: true, powerEfficient: true }))
    const adapter = createAdapter({
      hasHtmlVideo: () => true,
      hasMediaCapabilities: () => true,
      hasVideoDecoder: () => true,
      hasAudioDecoder: () => true,
      canPlayType: () => 'probably',
      decodingInfo,
      isVideoConfigSupported: async (config) => config.codec === 'avc1.640028',
      isAudioConfigSupported: async (config) => config.codec === 'mp4a.40.2',
    })
    const cache = new MemoryCache()
    const snapshot = await detectCapabilities({ adapter, cache, sdkVersion: 'test-media' })
    const report = await probeMediaCapabilities(createMedia(), { adapter, cache, snapshot, sdkVersion: 'test-media' })

    expect(report.native.playable).toBe('supported')
    expect(report.native.video.decodingInfo).toEqual({ supported: true, smooth: true, powerEfficient: true })
    expect(report.webCodecs.playable).toBe('supported')
    expect(report.query.video?.codec).toBe('avc1.640028')
    expect(report.query.audio?.codec).toBe('mp4a.40.2')
    expect(decodingInfo).toHaveBeenCalledOnce()
  })

  it('forwards demuxed audio codec private data into the AudioDecoder capability query', async () => {
    const media = createMedia()
    const audio = media.tracks.find((track) => track.kind === 'audio')
    if (!audio) throw new Error('missing fixture audio')
    const asc = Uint8Array.of(0x11, 0x90).buffer
    audio.codecPrivate = asc
    const audioProbe = vi.fn(async () => true)
    const adapter = createAdapter({
      hasVideoDecoder: () => true,
      hasAudioDecoder: () => true,
      isVideoConfigSupported: async () => true,
      isAudioConfigSupported: audioProbe,
    })
    const cache = new MemoryCache()
    const snapshot = await detectCapabilities({ adapter, cache, sdkVersion: 'test-audio-description' })
    const report = await probeMediaCapabilities(media, { adapter, cache, snapshot, sdkVersion: 'test-audio-description' })
    expect(report.query.audio?.description).toBe(asc)
    expect(audioProbe).toHaveBeenCalledWith(expect.objectContaining({ codec: 'mp4a.40.2', description: asc }))
  })

  it('uses only the present track when probing video-only media', async () => {
    const media = createMedia()
    media.tracks = media.tracks.filter((track) => track.kind === 'video')
    const adapter = createAdapter({
      hasHtmlVideo: () => true,
      hasVideoDecoder: () => true,
      canPlayType: () => 'maybe',
      isVideoConfigSupported: async () => true,
    })
    const cache = new MemoryCache()
    const snapshot = await detectCapabilities({ adapter, cache, sdkVersion: 'test-video-only' })
    const report = await probeMediaCapabilities(media, { adapter, cache, snapshot, sdkVersion: 'test-video-only' })

    expect(report.native.playable).toBe('supported')
    expect(report.webCodecs.playable).toBe('supported')
    expect(report.webCodecs.audio.configPresent).toBe(false)
  })

  it('reports probe failures as unknown instead of fabricating support', async () => {
    const adapter = createAdapter({
      hasHtmlVideo: () => true,
      hasMediaCapabilities: () => true,
      hasVideoDecoder: () => true,
      hasAudioDecoder: () => true,
      canPlayType: () => 'probably',
      decodingInfo: async () => { throw new Error('blocked') },
      isVideoConfigSupported: async () => { throw new Error('blocked') },
      isAudioConfigSupported: async () => { throw new Error('blocked') },
    })
    const cache = new MemoryCache()
    const snapshot = await detectCapabilities({ adapter, cache, sdkVersion: 'test-failure' })
    const report = await probeMediaCapabilities(createMedia(), { adapter, cache, snapshot, sdkVersion: 'test-failure' })

    expect(report.native.playable).toBe('unknown')
    expect(report.webCodecs.playable).toBe('unknown')
    expect(report.webCodecs.video.reasons).toEqual(['config-probe-failed'])
  })

  it('uses a probably canPlayType result when MediaCapabilities input is incomplete', async () => {
    const media = createMedia()
    const video = media.tracks.find((track) => track.kind === 'video')
    if (video) delete video.bitrate
    const decodingInfo = vi.fn(async () => ({ supported: true, smooth: true, powerEfficient: true }))
    const adapter = createAdapter({
      hasHtmlVideo: () => true,
      hasMediaCapabilities: () => true,
      canPlayType: () => 'probably',
      decodingInfo,
    })
    const cache = new MemoryCache()
    const snapshot = await detectCapabilities({ adapter, cache, sdkVersion: 'test-incomplete-native' })
    const report = await probeMediaCapabilities(media, { adapter, cache, snapshot, sdkVersion: 'test-incomplete-native' })

    expect(report.native.playable).toBe('supported')
    expect(report.native.video.reasons).toEqual(['can-play-type-probably', 'decoding-info-config-incomplete'])
    expect(decodingInfo).not.toHaveBeenCalled()
  })

  it('keeps a maybe canPlayType result unknown when MediaCapabilities input is incomplete', async () => {
    const media = createMedia()
    const video = media.tracks.find((track) => track.kind === 'video')
    if (video) delete video.bitrate
    const decodingInfo = vi.fn(async () => ({ supported: true, smooth: true, powerEfficient: true }))
    const adapter = createAdapter({
      hasHtmlVideo: () => true,
      hasMediaCapabilities: () => true,
      canPlayType: () => 'maybe',
      decodingInfo,
    })
    const cache = new MemoryCache()
    const snapshot = await detectCapabilities({ adapter, cache, sdkVersion: 'test-incomplete-native-maybe' })
    const report = await probeMediaCapabilities(media, { adapter, cache, snapshot, sdkVersion: 'test-incomplete-native-maybe' })

    expect(report.native.playable).toBe('unknown')
    expect(report.native.video.reasons).toEqual(['decoding-info-config-incomplete'])
    expect(decodingInfo).not.toHaveBeenCalled()
  })

  it('does not call AudioDecoder support checks with missing required fields', async () => {
    const media = createMedia()
    const audio = media.tracks.find((track) => track.kind === 'audio')
    if (audio) delete audio.sampleRate
    const audioProbe = vi.fn(async () => true)
    const adapter = createAdapter({
      hasVideoDecoder: () => true,
      hasAudioDecoder: () => true,
      isVideoConfigSupported: async () => true,
      isAudioConfigSupported: audioProbe,
    })
    const cache = new MemoryCache()
    const snapshot = await detectCapabilities({ adapter, cache, sdkVersion: 'test-incomplete-audio' })
    const report = await probeMediaCapabilities(media, { adapter, cache, snapshot, sdkVersion: 'test-incomplete-audio' })

    expect(report.webCodecs.playable).toBe('unknown')
    expect(report.webCodecs.audio.reasons).toEqual(['webcodecs-config-incomplete'])
    expect(audioProbe).not.toHaveBeenCalled()
  })
})
