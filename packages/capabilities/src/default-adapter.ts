import type { AudioCodecConfig, VideoCodecConfig, WebGpuFeatureSnapshot } from '@mx-player-max/types'
import { createFallbackGpuFeatures, type CapabilityProbeAdapter } from './contracts'

export function createDefaultProbeAdapter(): CapabilityProbeAdapter {
  return {
    getUserAgent: () => typeof navigator === 'undefined' ? '' : navigator.userAgent,
    getPlatform: () => typeof navigator === 'undefined' ? '' : navigator.platform,
    isCrossOriginIsolated: () => typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated,
    hasSharedArrayBuffer: () => typeof globalThis.SharedArrayBuffer !== 'undefined',
    hasHtmlVideo: () => typeof document !== 'undefined' && canCreateElement('video'),
    hasMediaCapabilities: () => typeof navigator !== 'undefined' && 'mediaCapabilities' in navigator
      && typeof navigator.mediaCapabilities?.decodingInfo === 'function',
    hasVideoDecoder: () => typeof getVideoDecoder() !== 'undefined',
    hasAudioDecoder: () => typeof getAudioDecoder() !== 'undefined',
    hasWebGl2: () => hasCanvasContext('webgl2'),
    hasCanvas2d: () => hasCanvasContext('2d'),
    hasWorkerMediaSource: () => {
      const mediaSource = (globalThis as typeof globalThis & {
        MediaSource?: { canConstructInDedicatedWorker?: boolean }
      }).MediaSource
      return mediaSource?.canConstructInDedicatedWorker === true
    },
    probeWasmSimd: () => validateWasm(SIMD_MODULE),
    probeWasmThreads: () => validateWasm(THREADS_MODULE),
    probeWebGpu,
    canPlayType: (contentType) => {
      if (typeof document === 'undefined') return ''
      try {
        return document.createElement('video').canPlayType(contentType)
      } catch {
        return ''
      }
    },
    decodingInfo: async (query) => {
      const mediaCapabilities = typeof navigator === 'undefined' ? undefined : navigator.mediaCapabilities
      if (!mediaCapabilities) throw new Error('CAPABILITY_API_UNAVAILABLE')
      const config: MediaDecodingConfiguration = { type: query.type }
      if (query.video) config.video = toMediaVideoConfiguration(query.video)
      if (query.audio) config.audio = toMediaAudioConfiguration(query.audio)
      const result = await mediaCapabilities.decodingInfo(config)
      return {
        supported: result.supported,
        smooth: result.smooth,
        powerEfficient: result.powerEfficient,
      }
    },
    isVideoConfigSupported: async (config) => {
      const decoder = getVideoDecoder()
      if (!decoder) throw new Error('CAPABILITY_API_UNAVAILABLE')
      const result = await decoder.isConfigSupported(toVideoDecoderConfig(config))
      return result.supported === true
    },
    isAudioConfigSupported: async (config) => {
      const decoder = getAudioDecoder()
      if (!decoder) throw new Error('CAPABILITY_API_UNAVAILABLE')
      const result = await decoder.isConfigSupported(toAudioDecoderConfig(config))
      return result.supported === true
    },
  }
}

function canCreateElement(tag: string): boolean {
  try {
    return typeof document?.createElement(tag) !== 'undefined'
  } catch {
    return false
  }
}

function hasCanvasContext(kind: 'webgl2' | '2d'): boolean {
  if (!canCreateElement('canvas')) return false
  try {
    return Boolean(document.createElement('canvas').getContext(kind))
  } catch {
    return false
  }
}

async function probeWebGpu(): Promise<WebGpuFeatureSnapshot> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return createFallbackGpuFeatures()
  try {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
    const adapter = await gpu?.requestAdapter()
    if (!adapter) return createFallbackGpuFeatures()
    const features = [...adapter.features]
    const limits = adapter.limits
    const info = adapter.info
    return {
      available: true,
      float32Filterable: features.includes('float32-filterable' as GPUFeatureName),
      shaderF16: features.includes('shader-f16' as GPUFeatureName),
      maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
      maxTextureDimension2d: limits.maxTextureDimension2D,
      maxBufferSize: limits.maxBufferSize,
      importExternalTexture: typeof (globalThis as typeof globalThis & { GPUDevice?: { prototype?: { importExternalTexture?: unknown } } }).GPUDevice?.prototype?.importExternalTexture === 'function',
      adapterVendor: info.vendor || null,
      adapterArchitecture: info.architecture || null,
      isFallbackAdapter: info.isFallbackAdapter,
    }
  } catch {
    return createFallbackGpuFeatures()
  }
}

function getVideoDecoder(): RuntimeVideoDecoder | undefined {
  return (globalThis as typeof globalThis & { VideoDecoder?: RuntimeVideoDecoder }).VideoDecoder
}

function getAudioDecoder(): RuntimeAudioDecoder | undefined {
  return (globalThis as typeof globalThis & { AudioDecoder?: RuntimeAudioDecoder }).AudioDecoder
}

function toVideoDecoderConfig(config: VideoCodecConfig): VideoDecoderConfig {
  const result = { codec: config.codec } as VideoDecoderConfig
  if (config.codedWidth !== undefined) result.codedWidth = config.codedWidth
  if (config.codedHeight !== undefined) result.codedHeight = config.codedHeight
  if (config.description !== undefined) result.description = config.description
  return result
}

function toAudioDecoderConfig(config: AudioCodecConfig): AudioDecoderConfig {
  const result = { codec: config.codec } as AudioDecoderConfig
  if (config.sampleRate !== undefined) result.sampleRate = config.sampleRate
  if (config.numberOfChannels !== undefined) result.numberOfChannels = config.numberOfChannels
  if (config.description !== undefined) result.description = config.description
  return result
}

function toMediaVideoConfiguration(
  config: VideoCodecConfig & { contentType: string },
): NonNullable<MediaDecodingConfiguration['video']> {
  const result = {
    contentType: config.contentType,
    ...(config.bitrate !== undefined ? { bitrate: config.bitrate } : {}),
    ...(config.framerate !== undefined ? { framerate: config.framerate } : {}),
  } as NonNullable<MediaDecodingConfiguration['video']>
  if (config.codedWidth !== undefined) result.width = config.codedWidth
  if (config.codedHeight !== undefined) result.height = config.codedHeight
  return result
}

function toMediaAudioConfiguration(
  config: AudioCodecConfig & { contentType: string },
): NonNullable<MediaDecodingConfiguration['audio']> {
  const result = { contentType: config.contentType } as NonNullable<MediaDecodingConfiguration['audio']>
  if (config.sampleRate !== undefined) result.samplerate = config.sampleRate
  if (config.numberOfChannels !== undefined) result.channels = String(config.numberOfChannels)
  if (config.bitrate !== undefined) result.bitrate = config.bitrate
  return result
}

interface RuntimeVideoDecoder {
  isConfigSupported(config: VideoDecoderConfig): Promise<{ supported?: boolean }>
}

interface RuntimeAudioDecoder {
  isConfigSupported(config: AudioDecoderConfig): Promise<{ supported?: boolean }>
}

const SIMD_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
const THREADS_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 4, 1, 3, 1, 1])

function validateWasm(bytes: Uint8Array): boolean {
  try {
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    return typeof WebAssembly !== 'undefined' && typeof WebAssembly.validate === 'function' && WebAssembly.validate(buffer)
  } catch {
    return false
  }
}
