import type { CapabilitySnapshot, TrackInfo } from '@mx-player-max/types'
import type { WasmDecoderManifest, WasmDecoderPlugin, WasmDecoderInstance } from '../src'

export const HELLO_HASH = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
export const HELLO_BYTES = new TextEncoder().encode('hello')

export function createManifest(overrides: Partial<WasmDecoderManifest> = {}): WasmDecoderManifest {
  return {
    codec: 'avc1',
    version: 'test-1',
    variants: { threaded: 'threaded.wasm', simd: 'simd.wasm', single: 'single.wasm' },
    sha256: { threaded: HELLO_HASH, simd: HELLO_HASH, single: HELLO_HASH },
    supportsVideo: true,
    supportsAudio: false,
    profiles: ['high'],
    levels: ['4.0'],
    pixelFormats: ['i420'],
    bitDepths: [8],
    license: 'MIT',
    upstream: 'https://example.test/upstream@commit',
    compiler: 'clang 18',
    buildFlags: '-O3 -msimd128',
    patentRisk: 'pending review',
    review: { status: 'approved' },
    ...overrides,
  }
}

export function createCapabilities(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    schemaVersion: 1,
    sdkVersion: '0.1.0',
    browser: 'unknown',
    browserVersion: null,
    platform: 'unknown',
    crossOriginIsolated: false,
    sharedArrayBuffer: false,
    wasmSimd: true,
    wasmThreads: false,
    htmlVideo: true,
    mediaCapabilities: false,
    webCodecsVideo: false,
    webCodecsAudio: false,
    webGpu: false,
    webGl2: false,
    canvas2d: true,
    workerMediaSource: false,
    webGpuFeatures: {
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
    },
    quirks: [],
    ...overrides,
  }
}

export const videoTrack: TrackInfo = {
  id: 1,
  kind: 'video',
  codecId: 'V_MPEG4/ISO/AVC',
  codec: 'avc1',
  width: 1920,
  height: 1080,
}

export function createInstance(variant: 'threaded' | 'simd' | 'single', onClose?: () => void): WasmDecoderInstance {
  return {
    variant,
    decodeQueueSize: 0,
    decode: () => {},
    flush: async () => {},
    reset: async () => {},
    close: () => onClose?.(),
  }
}

export function createPlugin(
  id: string,
  manifest = createManifest(),
  options: { priority?: number; supports?: (codec: string, track: TrackInfo) => boolean; create?: WasmDecoderPlugin['create'] } = {},
): WasmDecoderPlugin {
  return {
    id,
    priority: options.priority ?? 0,
    manifest,
    supports: options.supports ?? ((codec) => codec === manifest.codec),
    create: options.create ?? (async ({ variant }) => createInstance(variant)),
  }
}
