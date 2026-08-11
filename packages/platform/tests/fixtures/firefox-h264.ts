import type { BackendCandidate, CapabilitySnapshot, MediaDescriptor } from '@mx-player-max/types'

export const FIREFOX_H264_SAMPLE_ID = 'firefox-h264-webcodecs-configure-failure'

export function createFirefoxH264Snapshot(version = '145'): CapabilitySnapshot {
  return {
    schemaVersion: 1,
    sdkVersion: 'test',
    browser: 'gecko',
    browserVersion: version,
    platform: 'windows',
    crossOriginIsolated: false,
    sharedArrayBuffer: false,
    wasmSimd: true,
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
  }
}

export const firefoxH264Media: MediaDescriptor = {
  container: 'mp4',
  duration: 1,
  size: 1,
  mimeType: 'video/mp4',
  tracks: [{ id: 1, kind: 'video', codecId: 'avc', codec: 'avc1.640028' }],
}

export const firefoxH264Candidate: BackendCandidate = {
  id: 'webcodecs-custom',
  kind: 'webcodecs',
  videoCodec: 'avc1.640028',
  audioCodec: null,
  renderer: 'webgpu',
  score: 100,
  reasons: [],
  requires: ['VideoDecoder'],
}
