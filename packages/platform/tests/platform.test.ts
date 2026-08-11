import { describe, expect, it } from 'vitest'
import type {
  BackendCandidate,
  CapabilityContext,
  CapabilitySnapshot,
  MediaDescriptor,
} from '@mx-player-max/types'
import {
  BUILT_IN_PLATFORM_ISSUES,
  createPlatformDiagnostics,
  createPlatformPolicy,
  type PlatformRuntimeAdapter,
} from '../src/index'
import {
  FIREFOX_H264_SAMPLE_ID,
  createFirefoxH264Snapshot,
  firefoxH264Candidate,
  firefoxH264Media,
} from './fixtures/firefox-h264'

function createSnapshot(
  browser: CapabilitySnapshot['browser'],
  overrides: Partial<CapabilitySnapshot> = {},
): CapabilitySnapshot {
  return {
    schemaVersion: 1,
    sdkVersion: 'test',
    browser,
    browserVersion: '145',
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
    workerMediaSource: true,
    webGpuFeatures: {
      available: true,
      float32Filterable: false,
      shaderF16: false,
      maxComputeWorkgroupStorageSize: 32768,
      maxTextureDimension2d: 8192,
      maxBufferSize: 268435456,
      importExternalTexture: true,
      adapterVendor: null,
      adapterArchitecture: null,
      isFallbackAdapter: false,
    },
    quirks: [],
    ...overrides,
  }
}

function createRuntime(overrides: Partial<PlatformRuntimeAdapter> = {}): PlatformRuntimeAdapter {
  return {
    canPlayType: () => '',
    hasManagedMediaSource: () => false,
    hasHighDynamicRangeDisplay: () => false,
    hasAirPlay: () => false,
    hasPictureInPicture: () => false,
    hasFastSeek: () => false,
    hasPlaybackQuality: () => false,
    hasGeckoFrameCounters: () => false,
    ...overrides,
  }
}

function createContext(snapshot: CapabilitySnapshot): CapabilityContext {
  return {
    snapshot,
    media: {
      schemaVersion: 1,
      query: { container: 'mp4', mimeType: 'video/mp4', video: { codec: 'avc1.640028' }, audio: null },
      native: {
        video: { status: 'supported', reasons: [], contentType: 'video/mp4', canPlayType: 'probably' },
        audio: { status: 'unknown', reasons: ['track-absent'], contentType: null, canPlayType: '' },
        playable: 'supported',
        reasons: [],
      },
      webCodecs: {
        video: { status: 'supported', reasons: [], configPresent: true },
        audio: { status: 'unknown', reasons: ['track-absent'], configPresent: false },
        playable: 'supported',
        reasons: [],
      },
    },
  }
}

const media: MediaDescriptor = {
  container: 'mp4',
  duration: 1,
  size: 1,
  mimeType: 'video/mp4',
  tracks: [{ id: 1, kind: 'video', codecId: 'avc', codec: 'avc1.640028' }],
}

const webCodecsCandidate: BackendCandidate = {
  id: 'webcodecs-custom',
  kind: 'webcodecs',
  videoCodec: 'avc1.640028',
  audioCodec: null,
  renderer: 'webgpu',
  score: 100,
  reasons: [],
  requires: ['VideoDecoder'],
}

describe('platform enhancements', () => {
  it('reports optional enhancements only from concrete snapshot and runtime signals', () => {
    const snapshot = createSnapshot('webkit')
    const runtime = createRuntime({
      canPlayType: (contentType) => contentType.includes('hvc1') ? 'probably' : 'maybe',
      hasManagedMediaSource: () => true,
      hasHighDynamicRangeDisplay: () => true,
      hasAirPlay: () => true,
      hasPictureInPicture: () => true,
      hasFastSeek: () => true,
      hasPlaybackQuality: () => true,
    })
    const enhancements = createPlatformPolicy(snapshot, { runtime }).enhancements

    expect(enhancements).toEqual({
      nativeHls: true,
      nativeHevc: true,
      hdrDisplay: true,
      managedMediaSource: true,
      workerMediaSource: true,
      webGpuExternalTexture: true,
      airPlay: true,
      pictureInPicture: true,
      fastSeek: true,
      playbackQuality: true,
      geckoFrameCounters: false,
      diagnosticFrameCounters: true,
    })
  })

  it('keeps missing platform features false without weakening the generic path', () => {
    const snapshot = createSnapshot('unknown', {
      workerMediaSource: false,
      webGpuFeatures: { ...createSnapshot('unknown').webGpuFeatures, importExternalTexture: false },
    })
    const policy = createPlatformPolicy(snapshot, { runtime: createRuntime() })

    expect(Object.values(policy.enhancements).every((value) => value === false)).toBe(true)
    expect(policy.adjustScores([webCodecsCandidate], media, 'filters', createContext(snapshot))).toEqual([])
  })

  it('keeps the default runtime adapter safe when DOM APIs are absent', () => {
    const snapshot = createSnapshot('unknown', {
      workerMediaSource: false,
      webGpu: false,
      webGpuFeatures: { ...createSnapshot('unknown').webGpuFeatures, available: false, importExternalTexture: false },
    })

    expect(createPlatformPolicy(snapshot).enhancements).toEqual({
      nativeHls: false,
      nativeHevc: false,
      hdrDisplay: false,
      managedMediaSource: false,
      workerMediaSource: false,
      webGpuExternalTexture: false,
      airPlay: false,
      pictureInPicture: false,
      fastSeek: false,
      playbackQuality: false,
      geckoFrameCounters: false,
      diagnosticFrameCounters: false,
    })
  })
})

describe('platform score policy', () => {
  it('returns one immutable score delta for an existing capability-backed candidate', () => {
    const snapshot = createSnapshot('chromium')
    const policy = createPlatformPolicy(snapshot, { runtime: createRuntime() })
    const adjustments = policy.adjustScores([webCodecsCandidate], media, 'filters', createContext(snapshot))

    expect(adjustments).toEqual([{
      candidateId: 'webcodecs-custom',
      scoreDelta: 5,
      reasons: ['chromium-webcodecs-external-texture-hint'],
    }])
    expect(webCodecsCandidate.score).toBe(100)
  })

  it('cannot create a candidate when the candidate list is empty', () => {
    const snapshot = createSnapshot('webkit')
    const policy = createPlatformPolicy(snapshot, { runtime: createRuntime() })

    expect(policy.adjustScores([], media, 'normal', createContext(snapshot))).toEqual([])
  })

  it('adds WebKit HEVC and HDR hints only to an existing verified native candidate', () => {
    const snapshot = createSnapshot('webkit')
    const policy = createPlatformPolicy(snapshot, {
      runtime: createRuntime({
        canPlayType: (contentType) => contentType.includes('hvc1') ? 'probably' : '',
        hasHighDynamicRangeDisplay: () => true,
      }),
    })
    const hevcHdrMedia: MediaDescriptor = {
      ...media,
      tracks: [{
        id: 1,
        kind: 'video',
        codecId: 'hevc',
        codec: 'hvc1.1.6.L93.B0',
        color: { bitDepth: 10, primaries: 'bt2020', transfer: 'pq', hdrFormat: 'hdr10' },
      }],
    }
    const nativeCandidate: BackendCandidate = {
      id: 'native-html-video',
      kind: 'html-video',
      videoCodec: 'hvc1.1.6.L93.B0',
      audioCodec: null,
      renderer: 'native',
      score: 100,
      reasons: [],
      requires: ['HTMLVideoElement'],
    }

    expect(policy.adjustScores(
      [nativeCandidate],
      hevcHdrMedia,
      'normal',
      createContext(snapshot),
    )).toEqual([{
      candidateId: 'native-html-video',
      scoreDelta: 25,
      reasons: [
        'webkit-native-hdr-display-hint',
        'webkit-native-hevc-hint',
        'webkit-native-media-hint',
      ],
    }])
  })

  it('applies the audited Firefox H.264 issue rule only inside its version range', () => {
    const snapshot = createFirefoxH264Snapshot('145.0.2')
    const policy = createPlatformPolicy(snapshot, {
      runtime: createRuntime(),
      now: new Date('2026-08-11T00:00:00Z'),
    })

    expect(policy.adjustScores(
      [firefoxH264Candidate],
      firefoxH264Media,
      'filters',
      createContext(snapshot),
    )).toEqual([{
      candidateId: 'webcodecs-custom',
      scoreDelta: -95,
      reasons: [
        'gecko-frame-access-hint',
        'platform-issue:firefox-1918769-h264-webcodecs-configure',
      ],
    }])
    expect(BUILT_IN_PLATFORM_ISSUES[0]?.issueUrl).toBe('https://bugzilla.mozilla.org/show_bug.cgi?id=1918769')
    expect(BUILT_IN_PLATFORM_ISSUES[0]?.testSample).toContain(FIREFOX_H264_SAMPLE_ID)
  })

  it('does not apply issue rules after the version range or expiry date', () => {
    const fixedSnapshot = createFirefoxH264Snapshot('146')
    const expiredSnapshot = createFirefoxH264Snapshot('145')

    const fixed = createPlatformPolicy(fixedSnapshot, {
      runtime: createRuntime(),
      now: new Date('2026-08-11T00:00:00Z'),
    }).adjustScores([firefoxH264Candidate], firefoxH264Media, 'filters', createContext(fixedSnapshot))
    const expired = createPlatformPolicy(expiredSnapshot, {
      runtime: createRuntime(),
      now: new Date('2027-04-01T00:00:00Z'),
    }).adjustScores([firefoxH264Candidate], firefoxH264Media, 'filters', createContext(expiredSnapshot))

    expect(fixed[0]?.scoreDelta).toBe(5)
    expect(expired[0]?.scoreDelta).toBe(5)
    expect(fixed[0]?.reasons).not.toContain('platform-issue:firefox-1918769-h264-webcodecs-configure')
    expect(expired[0]?.reasons).not.toContain('platform-issue:firefox-1918769-h264-webcodecs-configure')
  })

  it('ignores malformed and positive issue rules', () => {
    const snapshot = createSnapshot('chromium')
    const policy = createPlatformPolicy(snapshot, {
      runtime: createRuntime(),
      issueRules: [{
        id: 'invalid-positive-rule',
        browser: 'chromium',
        versions: {},
        issueUrl: 'not-a-url',
        expiresOn: 'not-a-date',
        testSample: '',
        scoreDelta: 100,
        match: {},
      }],
    })

    expect(policy.issueRules).toEqual([])
    expect(policy.adjustScores([webCodecsCandidate], media, 'filters', createContext(snapshot))[0]?.scoreDelta).toBe(5)
  })
})

describe('platform diagnostics', () => {
  it('reads standard and Gecko frame counters without using them for scoring', () => {
    const video = {
      getVideoPlaybackQuality: () => ({
        totalVideoFrames: 120,
        droppedVideoFrames: 3,
        corruptedVideoFrames: 1,
      }),
      mozDecodedFrames: 125,
      mozPresentedFrames: 120,
      mozPaintedFrames: 119,
      mozFrameDelay: 0.004,
    } as unknown as HTMLVideoElement
    const diagnostics = createPlatformDiagnostics()

    expect(diagnostics.snapshot(video).playbackQuality).toEqual({
      standard: { totalVideoFrames: 120, droppedVideoFrames: 3, corruptedVideoFrames: 1 },
      gecko: { decodedFrames: 125, presentedFrames: 120, paintedFrames: 119, frameDelaySeconds: 0.004 },
    })
  })

  it('records explicit WebCodecs acceleration outcomes without inferring hardware use', () => {
    const diagnostics = createPlatformDiagnostics()
    diagnostics.recordWebCodecsAcceleration({
      codec: 'avc1.640028',
      requestedPreference: 'prefer-hardware',
      support: 'supported',
      selected: 'unknown',
      reasons: ['config-supported-selection-not-observable'],
    })

    const first = diagnostics.snapshot()
    expect(first.webCodecsAcceleration).toEqual([{
      codec: 'avc1.640028',
      requestedPreference: 'prefer-hardware',
      support: 'supported',
      selected: 'unknown',
      reasons: ['config-supported-selection-not-observable'],
    }])
    diagnostics.reset()
    expect(diagnostics.snapshot().webCodecsAcceleration).toEqual([])
  })

  it('returns empty diagnostics when media APIs throw or expose invalid values', () => {
    const video = {
      getVideoPlaybackQuality: () => { throw new Error('blocked') },
      mozDecodedFrames: -1,
      mozPresentedFrames: Number.NaN,
    } as unknown as HTMLVideoElement

    expect(createPlatformDiagnostics().snapshot(video).playbackQuality).toEqual({ standard: null, gecko: null })
  })
})
