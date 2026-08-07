import type { CapabilitySnapshot, WebGpuFeatureSnapshot } from '@mx-player-max/types'

export interface CapabilityProbeOptions {
  forceRefresh?: boolean
}

export async function detectCapabilities(_options: CapabilityProbeOptions = {}): Promise<CapabilitySnapshot> {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const browser = /Firefox\//i.test(userAgent)
    ? 'gecko'
    : /Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)
      ? 'webkit'
      : /Chrome\//i.test(userAgent) || /Chromium\//i.test(userAgent)
        ? 'chromium'
        : 'unknown'
  const crossOriginIsolated = typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated
  const hasSharedArrayBuffer = typeof globalThis.SharedArrayBuffer !== 'undefined'
  const hasVideoDecoder = typeof globalThis.VideoDecoder !== 'undefined'
  const hasAudioDecoder = typeof globalThis.AudioDecoder !== 'undefined'
  /* Fix: `'gpu' in navigator` does not guarantee a usable GPU device.
     Adapter request can still fail or return a fallback (software) adapter. */
  const hasGpuAPI = typeof navigator !== 'undefined' && 'gpu' in navigator
  const hasWebGl2 = typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext('webgl2'))
  const hasCanvas2d = typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext('2d'))
  const wasmSimd = typeof WebAssembly !== 'undefined'
    && typeof WebAssembly.validate === 'function'
    && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 32, 0, 253, 15, 253, 98, 11]))
  const webGpuFeatures = await probeWebGpu(hasGpuAPI)
  return {
    browser,
    browserVersion: null,
    platform: typeof navigator === 'undefined' ? 'unknown' : navigator.platform,
    crossOriginIsolated,
    sharedArrayBuffer: hasSharedArrayBuffer,
    wasmSimd,
    wasmThreads: crossOriginIsolated && hasSharedArrayBuffer,
    webCodecsVideo: hasVideoDecoder,
    webCodecsAudio: hasAudioDecoder,
    webGpu: webGpuFeatures.available,
    webGl2: hasWebGl2,
    canvas2d: hasCanvas2d,
    workerMediaSource: false,
    webGpuFeatures,
    quirks: [],
  }
}

const FALLBACK_GPU_FEATURES: WebGpuFeatureSnapshot = {
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

async function probeWebGpu(hasGpuAPI: boolean): Promise<WebGpuFeatureSnapshot> {
  if (!hasGpuAPI) return FALLBACK_GPU_FEATURES
  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return FALLBACK_GPU_FEATURES
    const info = adapter.info
    const features = [...adapter.features]
    const limits = adapter.limits
    return {
      available: true,
      float32Filterable: features.includes('float32-filterable' as GPUFeatureName),
      shaderF16: features.includes('shader-f16' as GPUFeatureName),
      maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
      maxTextureDimension2d: limits.maxTextureDimension2D,
      maxBufferSize: limits.maxBufferSize,
      importExternalTexture: features.includes('import-external-texture' as GPUFeatureName),
      adapterVendor: info.vendor,
      adapterArchitecture: info.architecture,
      isFallbackAdapter: info.isFallbackAdapter,
    }
  } catch {
    return FALLBACK_GPU_FEATURES
  }
}
