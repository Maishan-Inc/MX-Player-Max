import { describe, expect, it } from 'vitest'
import type {
  BackendCandidate,
  CapabilityContext,
  CapabilitySnapshot,
  MediaCapabilityReport,
  MediaDescriptor,
  PlatformScoreAdjustment,
} from '@mx-player-max/types'
import {
  StrategySelectionError,
  applyPlatformAdjustments,
  createStrategyEngine,
  type PlatformPolicy,
} from '../src/index'

function createSnapshot(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    schemaVersion: 1,
    sdkVersion: 'test',
    browser: 'unknown',
    browserVersion: null,
    platform: 'unknown',
    crossOriginIsolated: false,
    sharedArrayBuffer: false,
    wasmSimd: false,
    wasmThreads: false,
    htmlVideo: true,
    mediaCapabilities: true,
    webCodecsVideo: true,
    webCodecsAudio: true,
    webGpu: true,
    webGl2: true,
    canvas2d: true,
    workerMediaSource: false,
    webGpuFeatures: {
      available: true,
      float32Filterable: false,
      shaderF16: false,
      maxComputeWorkgroupStorageSize: 32768,
      maxTextureDimension2d: 8192,
      maxBufferSize: 268435456,
      importExternalTexture: false,
      adapterVendor: null,
      adapterArchitecture: null,
      isFallbackAdapter: false,
    },
    quirks: [],
    ...overrides,
  }
}

function createReport(overrides: Partial<MediaCapabilityReport> = {}): MediaCapabilityReport {
  return {
    schemaVersion: 1,
    query: {
      container: 'mp4',
      mimeType: 'video/mp4',
      video: { codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080, framerate: 30 },
      audio: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 },
    },
    native: {
      video: {
        status: 'supported',
        reasons: ['decoding-info-supported'],
        contentType: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
        canPlayType: 'probably',
        decodingInfo: { supported: true, smooth: true, powerEfficient: true },
      },
      audio: {
        status: 'supported',
        reasons: ['decoding-info-supported'],
        contentType: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
        canPlayType: 'probably',
        decodingInfo: { supported: true, smooth: true, powerEfficient: true },
      },
      playable: 'supported',
      reasons: ['decoding-info-supported'],
    },
    webCodecs: {
      video: { status: 'supported', reasons: ['config-supported'], configPresent: true },
      audio: { status: 'supported', reasons: ['config-supported'], configPresent: true },
      playable: 'supported',
      reasons: ['config-supported'],
    },
    ...overrides,
  }
}

function createMedia(hdr = false): MediaDescriptor {
  return {
    container: 'mp4',
    duration: 10_000_000,
    size: 1024,
    mimeType: 'video/mp4',
    tracks: [
      {
        id: 1,
        kind: 'video',
        codecId: 'avc',
        codec: 'avc1.640028',
        ...(hdr ? { color: { bitDepth: 10, primaries: 'bt2020', transfer: 'pq', hdrFormat: 'hdr10' } as const } : {}),
      },
      { id: 2, kind: 'audio', codecId: 'aac', codec: 'mp4a.40.2' },
    ],
  }
}

function createContext(
  snapshot = createSnapshot(),
  report = createReport(),
  wasmDecoders?: CapabilityContext['wasmDecoders'],
  webCodecsCodecs?: CapabilityContext['webCodecsCodecs'],
): CapabilityContext {
  return {
    snapshot,
    media: report,
    ...(wasmDecoders ? { wasmDecoders } : {}),
    ...(webCodecsCodecs ? { webCodecsCodecs } : {}),
  }
}

/** What `@mx-player-max/decoder-webcodecs` declares, trimmed to the entries these cases need. */
const ENGINE_SCOPE: NonNullable<CapabilityContext['webCodecsCodecs']> = [
  { kind: 'video', match: 'prefix', codec: 'avc1.' },
  { kind: 'video', match: 'exact', codec: 'vp8' },
  { kind: 'audio', match: 'prefix', codec: 'mp4a.40.', maxChannels: 2 },
  { kind: 'audio', match: 'exact', codec: 'opus', maxChannels: 2 },
]

/** A report where the browser verifies the track but the engine's own scope may not cover it. */
function createVerifiedReport(
  video: { codec: string },
  audio: { codec: string; numberOfChannels?: number } | null,
): MediaCapabilityReport {
  return createReport({
    query: {
      container: 'matroska',
      mimeType: 'video/x-matroska',
      video: { codec: video.codec, codedWidth: 320, codedHeight: 180, framerate: 30 },
      audio: audio === null ? null : { codec: audio.codec, sampleRate: 48_000, numberOfChannels: audio.numberOfChannels ?? 2 },
    },
  })
}

describe('strategy engine', () => {
  it('prefers smooth and power-efficient native playback for normal intent', () => {
    const context = createContext()
    const selection = createStrategyEngine().select(createMedia(), 'normal', context)

    expect(selection.backend.kind).toBe('html-video')
    expect(selection.backend.reasons).toContain('power-efficient')
    expect(selection.mediaCapabilities).toBe(context.media)
  })

  it('uses a custom pipeline for frame-access intents and falls back between renderers', () => {
    const snapshot = createSnapshot({ webGpu: false, webGl2: true })
    const ranked = createStrategyEngine().rank(createMedia(), 'filters', createContext(snapshot))

    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.kind).toBe('webcodecs')
    expect(ranked[0]?.renderer).toBe('webgl2')
    expect(ranked[0]?.reasons).toContain('renderer-fallback-chain:webgl2>canvas2d')
  })

  it('eliminates WebGPU when its reported texture limit is unusable', () => {
    const base = createSnapshot()
    const ranked = createStrategyEngine().rank(createMedia(), 'filters', createContext(createSnapshot({
      webGpuFeatures: { ...base.webGpuFeatures, maxTextureDimension2d: 0 },
    })))
    expect(ranked[0]?.renderer).toBe('webgl2')
    expect(ranked[0]?.reasons).toContain('renderer-fallback-chain:webgl2>canvas2d')
  })

  it('adds a native color-management preference for HDR normal playback', () => {
    const ranked = createStrategyEngine().rank(createMedia(true), 'normal', createContext())
    const native = ranked.find((candidate) => candidate.kind === 'html-video')

    expect(native?.reasons).toContain('native-hdr-color-management')
    expect(native?.score).toBe(200)
  })

  it('does not create a WebCodecs candidate from a report when the API snapshot is unavailable', () => {
    const snapshot = createSnapshot({ webCodecsVideo: false, webCodecsAudio: false })
    const ranked = createStrategyEngine().rank(createMedia(), 'filters', createContext(snapshot))

    expect(ranked).toEqual([])
    expect(() => createStrategyEngine().select(createMedia(), 'filters', createContext(snapshot))).toThrow(StrategySelectionError)
  })

  it('does not create a custom candidate when no renderer is available', () => {
    const snapshot = createSnapshot({ webGpu: false, webGl2: false, canvas2d: false })
    expect(createStrategyEngine().rank(createMedia(), 'editing', createContext(snapshot))).toEqual([])
  })

  it('keeps ai-enhance on WebCodecs and records passthrough when WebGPU is unavailable', () => {
    const snapshot = createSnapshot({ webGpu: false, webGl2: true })
    const ranked = createStrategyEngine().rank(createMedia(), 'ai-enhance', createContext(snapshot))
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.kind).toBe('webcodecs')
    expect(ranked[0]?.id).toBe('webcodecs-ai')
    expect(ranked[0]?.renderer).toBe('webgl2')
    expect(ranked[0]?.reasons).toContain('ai-passthrough-fallback')
    expect(createStrategyEngine().select(createMedia(), 'ai-enhance', createContext(snapshot)).aiPlan?.proposedTier).toBe('off')
  })

  it('keeps a software fallback adapter on passthrough instead of enabling AI stages', () => {
    const base = createSnapshot()
    const snapshot = createSnapshot({
      webGpuFeatures: { ...base.webGpuFeatures, isFallbackAdapter: true },
    })
    const selection = createStrategyEngine().select(createMedia(), 'ai-enhance', createContext(snapshot))

    expect(selection.backend.kind).toBe('webcodecs')
    expect(selection.aiPlan).toEqual({
      interpolation: false,
      superResolution: false,
      proposedTier: 'off',
      reasons: ['webgpu-unavailable-or-software'],
    })
    expect(selection.backend.reasons).toContain('ai-passthrough-fallback')
  })

  it('does not create a decoder candidate for media with no tracks', () => {
    const media = createMedia()
    media.tracks = []
    const report = createReport({
      query: { container: 'mp4', mimeType: 'video/mp4', video: null, audio: null },
      native: {
        video: { status: 'unknown', reasons: ['track-absent'], contentType: null, canPlayType: '' },
        audio: { status: 'unknown', reasons: ['track-absent'], contentType: null, canPlayType: '' },
        playable: 'unknown',
        reasons: ['no-media-track'],
      },
      webCodecs: {
        video: { status: 'supported', reasons: [], configPresent: false },
        audio: { status: 'supported', reasons: [], configPresent: false },
        playable: 'supported',
        reasons: [],
      },
    })

    expect(createStrategyEngine().rank(media, 'filters', createContext(createSnapshot(), report))).toEqual([])
  })

  it('requires explicit declarations for every present WASM-decoded track', () => {
    const snapshot = createSnapshot({ webCodecsVideo: false, webCodecsAudio: false, wasmSimd: true, wasmThreads: false })
    const unsupportedReport = createReport({
      webCodecs: {
        video: { status: 'unsupported', reasons: ['config-unsupported'], configPresent: true },
        audio: { status: 'unsupported', reasons: ['config-unsupported'], configPresent: true },
        playable: 'unsupported',
        reasons: ['config-unsupported'],
      },
    })
    const noDeclarations = createContext(snapshot, unsupportedReport)
    const declarations = [
      { codec: 'avc1.640028', supportsVideo: true, supportsAudio: false, variants: ['single', 'simd'] as const },
      { codec: 'mp4a.40.2', supportsVideo: false, supportsAudio: true, variants: ['single'] as const },
    ]
    const declared = createContext(snapshot, unsupportedReport, declarations)

    expect(createStrategyEngine().rank(createMedia(), 'filters', noDeclarations)).toEqual([])
    const candidate = createStrategyEngine().rank(createMedia(), 'filters', declared)[0]
    expect(candidate?.kind).toBe('wasm')
    expect(candidate?.reasons).toContain('wasm-simd')
    expect(candidate?.reasons).not.toContain('wasm-threads')
  })

  it('does not create a Phase 10.2 WASM candidate when an audio track lacks a declaration', () => {
    const snapshot = createSnapshot({ webCodecsVideo: false, webCodecsAudio: false })
    const unsupportedReport = createReport({
      webCodecs: {
        video: { status: 'unsupported', reasons: [], configPresent: true },
        audio: { status: 'unsupported', reasons: [], configPresent: true },
        playable: 'unsupported', reasons: [],
      },
    })
    const context = createContext(snapshot, unsupportedReport, [
      { codec: 'avc1.640028', supportsVideo: true, supportsAudio: false, variants: ['single'] },
    ])

    expect(createStrategyEngine().rank(createMedia(), 'frame-access', context)).toEqual([])
  })

  /**
   * Capability probing reports what the browser can decode; the engine's own WebCodecs backend
   * covers less. Chrome decodes Vorbis given the container's CodecPrivate, so `flower.webm` used to
   * be ranked, selected, and then fail with `WEBCODECS_AUDIO_NOT_SUPPORTED` while the pipeline was
   * initialising. The candidate is now withheld, and the code it would have failed with is kept.
   */
  it.each([
    ['an audio codec', { codec: 'vp8' }, { codec: 'vorbis' }, 'WEBCODECS_AUDIO_NOT_SUPPORTED', 'audio-codec-outside-engine-scope:vorbis'],
    ['a video codec', { codec: 'hvc1.2.4.L120.B0' }, { codec: 'opus' }, 'WEBCODECS_NOT_SUPPORTED', 'video-codec-outside-engine-scope:hvc1.2.4.L120.B0'],
    ['a channel layout', { codec: 'vp8' }, { codec: 'opus', numberOfChannels: 6 }, 'AUDIO_CHANNEL_LAYOUT_UNSUPPORTED', 'audio-channels-outside-engine-scope:6'],
  ] as const)('withholds the WebCodecs candidate when the engine scope excludes %s', (_label, video, audio, errorCode, reason) => {
    const report = createVerifiedReport(video, audio)
    const context = createContext(createSnapshot(), report, undefined, ENGINE_SCOPE)
    const evaluation = createStrategyEngine().evaluate(createMedia(), 'filters', context)

    expect(evaluation.rankedCandidates).toEqual([])
    expect(evaluation.exclusions).toEqual([{ candidateId: 'webcodecs-custom', kind: 'webcodecs', errorCode, reasons: [reason] }])
    expect(() => createStrategyEngine().select(createMedia(), 'filters', context)).toThrow(StrategySelectionError)
  })

  it('names the ai-enhance candidate in its exclusion so the reason survives per intent', () => {
    const context = createContext(createSnapshot(), createVerifiedReport({ codec: 'vp8' }, { codec: 'vorbis' }), undefined, ENGINE_SCOPE)
    expect(createStrategyEngine().evaluate(createMedia(), 'ai-enhance', context).exclusions?.[0]?.candidateId).toBe('webcodecs-ai')
  })

  it('still ranks WebCodecs for codecs inside the engine scope and reports no exclusions', () => {
    const context = createContext(createSnapshot(), createVerifiedReport({ codec: 'avc1.640028' }, { codec: 'mp4a.40.2' }), undefined, ENGINE_SCOPE)
    const evaluation = createStrategyEngine().evaluate(createMedia(), 'filters', context)

    expect(evaluation.rankedCandidates.map((candidate) => candidate.id)).toEqual(['webcodecs-custom'])
    expect(evaluation.exclusions).toBeUndefined()
  })

  /** A host that declares no scope keeps the behaviour that existed before the scope was plumbed. */
  it('keeps ranking WebCodecs when the host declares no codec scope', () => {
    const context = createContext(createSnapshot(), createVerifiedReport({ codec: 'vp8' }, { codec: 'vorbis' }))
    const evaluation = createStrategyEngine().evaluate(createMedia(), 'filters', context)

    expect(evaluation.rankedCandidates.map((candidate) => candidate.id)).toEqual(['webcodecs-custom'])
    expect(evaluation.exclusions).toBeUndefined()
  })

  it('leaves a video-only track in scope when the engine declares no audio codec for it', () => {
    const context = createContext(createSnapshot(), createVerifiedReport({ codec: 'vp8' }, null), undefined, ENGINE_SCOPE)
    expect(createStrategyEngine().evaluate(createMedia(), 'filters', context).rankedCandidates).toHaveLength(1)
  })

  it('uses deterministic tie-breaking without mutating candidates', () => {
    const report = createReport({
      native: {
        video: { status: 'supported', reasons: [], contentType: 'video/mp4', canPlayType: 'maybe' },
        audio: { status: 'supported', reasons: [], contentType: 'video/mp4', canPlayType: 'maybe' },
        playable: 'supported',
        reasons: [],
      },
    })
    const policy: PlatformPolicy = {
      adjustScores: () => [{ candidateId: 'native-html-video', scoreDelta: -10, reasons: ['tie'] }],
    }
    const engine = createStrategyEngine(policy)
    const first = engine.rank(createMedia(), 'normal', createContext(createSnapshot(), report))
    const second = engine.rank(createMedia(), 'normal', createContext(createSnapshot(), report))

    expect(first).toEqual(second)
    expect(first.map((candidate) => candidate.kind)).toEqual(['html-video', 'webcodecs'])
  })

  it('evaluates base candidates, adjustments, ranking, and selection in one policy pass', () => {
    let calls = 0
    const policy: PlatformPolicy = {
      adjustScores(candidates) {
        calls += 1
        expect(candidates.find((candidate) => candidate.id === 'native-html-video')?.score).toBe(170)
        return [{ candidateId: 'native-html-video', scoreDelta: -200, reasons: ['runtime-regression'] }]
      },
    }
    const evaluation = createStrategyEngine(policy).evaluate(createMedia(), 'normal', createContext())

    expect(calls).toBe(1)
    expect(evaluation.baseCandidates.find((candidate) => candidate.id === 'native-html-video')?.score).toBe(170)
    expect(evaluation.adjustments).toEqual([
      { candidateId: 'native-html-video', scoreDelta: -200, reasons: ['runtime-regression'] },
    ])
    expect(evaluation.rankedCandidates.map((candidate) => candidate.id)).toEqual(['webcodecs-custom', 'native-html-video'])
    expect(evaluation.selection?.backend.id).toBe('webcodecs-custom')
    expect(evaluation.baseCandidates).not.toBe(evaluation.rankedCandidates)
  })
})

describe('platform score adjustments', () => {
  it('ignores unknown, duplicate, and non-finite adjustments', () => {
    const source: BackendCandidate[] = [{
      id: 'known',
      kind: 'webcodecs',
      videoCodec: 'avc1.640028',
      audioCodec: null,
      renderer: 'webgpu',
      score: 10,
      reasons: ['base'],
      requires: ['VideoDecoder'],
    }]
    const adjustments: PlatformScoreAdjustment[] = [
      { candidateId: 'known', scoreDelta: 5, reasons: ['valid'] },
      { candidateId: 'known', scoreDelta: 100, reasons: ['duplicate'] },
      { candidateId: 'unknown', scoreDelta: 100, reasons: ['fabricated'] },
      { candidateId: 'known', scoreDelta: Number.NaN, reasons: ['invalid'] },
    ]

    const result = applyPlatformAdjustments(source, adjustments)

    expect(result).toEqual([{ ...source[0], score: 15, reasons: ['base', 'valid'] }])
    expect(source[0]?.score).toBe(10)
    expect(source[0]?.reasons).toEqual(['base'])
  })
})
