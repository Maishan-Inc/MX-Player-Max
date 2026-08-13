import type {
  AudioCodecConfig,
  CapabilitySnapshot,
  DecodingCapabilityInfo,
  VideoCodecConfig,
  WebGpuFeatureSnapshot,
} from '@mx-player-max/types'

export const CAPABILITY_SCHEMA_VERSION = 1
export const DEFAULT_SDK_VERSION = '0.1.0'

export interface CapabilityCache {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
}

export interface CapabilityProbeOptions {
  forceRefresh?: boolean
  includeWasm?: boolean
  sdkVersion?: string
  cache?: CapabilityCache
  adapter?: CapabilityProbeAdapter
}

export interface MediaCapabilityProbeOptions extends CapabilityProbeOptions {
  snapshot?: CapabilitySnapshot
}

export interface MediaDecodingQuery {
  type: 'file'
  video?: VideoCodecConfig & { contentType: string }
  audio?: AudioCodecConfig & { contentType: string }
}

export interface CapabilityProbeAdapter {
  getUserAgent(): string
  getPlatform(): string
  isCrossOriginIsolated(): boolean
  hasSharedArrayBuffer(): boolean
  hasHtmlVideo(): boolean
  hasMediaCapabilities(): boolean
  hasVideoDecoder(): boolean
  hasAudioDecoder(): boolean
  hasWebGl2(): boolean
  hasCanvas2d(): boolean
  hasWorkerMediaSource(): boolean
  probeWasmSimd(): boolean
  probeWasmThreads(): boolean
  probeWebGpu(): Promise<WebGpuFeatureSnapshot>
  canPlayType(contentType: string): string
  decodingInfo(query: MediaDecodingQuery): Promise<DecodingCapabilityInfo>
  isVideoConfigSupported(config: VideoCodecConfig): Promise<boolean>
  isAudioConfigSupported(config: AudioCodecConfig): Promise<boolean>
}

export function createFallbackGpuFeatures(): WebGpuFeatureSnapshot {
  return {
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
}
