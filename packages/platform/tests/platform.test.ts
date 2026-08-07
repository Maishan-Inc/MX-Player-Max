import { describe, expect, it } from 'vitest'
import type { BackendCandidate, CapabilityContext, CapabilitySnapshot, MediaDescriptor } from '@mx-player-max/types'
import { createPlatformPolicy } from '../src/index'

function createSnapshot(browser: CapabilitySnapshot['browser']): CapabilitySnapshot {
  return {
    schemaVersion: 1,
    sdkVersion: 'test',
    browser,
    browserVersion: '1',
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

describe('platform policy', () => {
  it('returns score deltas only for existing, capability-backed candidates', () => {
    const snapshot = createSnapshot('chromium')
    const policy = createPlatformPolicy(snapshot)
    const adjustments = policy.adjustScores([webCodecsCandidate], media, 'filters', createContext(snapshot))

    expect(adjustments).toEqual([{
      candidateId: 'webcodecs-custom',
      scoreDelta: 5,
      reasons: ['chromium-webcodecs-webgpu-hint'],
    }])
    expect(webCodecsCandidate.score).toBe(100)
  })

  it('cannot create a candidate when the candidate list is empty', () => {
    const snapshot = createSnapshot('webkit')
    const policy = createPlatformPolicy(snapshot)

    expect(policy.adjustScores([], media, 'normal', createContext(snapshot))).toEqual([])
  })

  it('reports optional enhancements from concrete snapshot/API signals', () => {
    const snapshot = createSnapshot('unknown')
    const enhancements = createPlatformPolicy(snapshot).detectEnhancements(snapshot)

    expect(enhancements.workerMediaSource).toBe(true)
    expect(enhancements.webGpuExternalTexture).toBe(true)
  })
})
