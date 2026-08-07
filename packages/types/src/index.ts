export type SourceDescriptor =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string; headers?: Record<string, string> }

export type TrackKind = 'video' | 'audio' | 'subtitle'

/** Microsecond timestamps as integers. See docs/architecture/overview.md §5. */
export type Micros = number

export type PlaybackIntent = 'normal' | 'frame-access' | 'filters' | 'editing' | 'low-power' | 'ai-enhance'

export interface TrackInfo {
  id: number
  kind: TrackKind
  codecId: string
  codec?: string
  codecPrivate?: ArrayBuffer
  language?: string
  name?: string
  width?: number
  height?: number
  frameRate?: number
  bitDepth?: number
  colorSpace?: string
  hdr?: boolean
  sampleRate?: number
  channels?: number
}

export interface MediaDescriptor {
  container: string
  tracks: TrackInfo[]
  duration: number | null
  size: number | null
  mimeType: string | null
}

export interface WebGpuFeatureSnapshot {
  available: boolean
  float32Filterable: boolean
  shaderF16: boolean
  maxComputeWorkgroupStorageSize: number
  maxTextureDimension2d: number
  maxBufferSize: number
  importExternalTexture: boolean
  adapterVendor: string | null
  adapterArchitecture: string | null
  isFallbackAdapter: boolean
}

export interface CapabilitySnapshot {
  browser: 'chromium' | 'webkit' | 'gecko' | 'unknown'
  browserVersion: string | null
  platform: string
  crossOriginIsolated: boolean
  sharedArrayBuffer: boolean
  wasmSimd: boolean
  wasmThreads: boolean
  webCodecsVideo: boolean
  webCodecsAudio: boolean
  webGpu: boolean
  webGl2: boolean
  canvas2d: boolean
  workerMediaSource: boolean
  webGpuFeatures: WebGpuFeatureSnapshot
  quirks: string[]
}

export type BackendKind = 'html-video' | 'webcodecs' | 'wasm'
export type RendererKind = 'native' | 'webgpu' | 'webgl2' | 'canvas2d'

export interface BackendCandidate {
  id: string
  kind: BackendKind
  videoCodec: string | null
  audioCodec: string | null
  renderer: RendererKind
  score: number
  reasons: string[]
  requires: string[]
}

export interface AiPlan {
  readonly interpolation: boolean
  readonly superResolution: boolean
  readonly proposedTier: AiQualityTier
  readonly reasons: string[]
}

export interface PlaybackSelection {
  backend: BackendCandidate
  intent: PlaybackIntent
  capabilities: CapabilitySnapshot
  aiPlan?: AiPlan
}

export interface SubtitleCue {
  start: number
  end: number
  text: string
  style?: SubtitleCueStyle
}

export interface SubtitleCueStyle {
  fontFamily?: string
  fontSize?: number
  color?: string
  outlineColor?: string
  outlineWidth?: number
  x?: number
  y?: number
}

export interface EngineError {
  code: string
  message: string
  cause?: unknown
  recoverable: boolean
}

/**
 * Known error codes. Projects extending the RENDERER_* namespace should keep
 * all AI-related failures under RENDERER_AI_* to avoid modifying the
 * cross-module error-code domain list in AGENTS.md §7.
 */
export const ErrorCodes = {
  RENDERER_AI_UNSUPPORTED: 'RENDERER_AI_UNSUPPORTED',
  RENDERER_AI_MODEL_LOAD_FAILED: 'RENDERER_AI_MODEL_LOAD_FAILED',
  RENDERER_AI_MODEL_HASH_MISMATCH: 'RENDERER_AI_MODEL_HASH_MISMATCH',
  RENDERER_AI_PIPELINE_FAILED: 'RENDERER_AI_PIPELINE_FAILED',
  RENDERER_AI_BUDGET_EXCEEDED: 'RENDERER_AI_BUDGET_EXCEEDED',
  RENDERER_AI_DEVICE_LOST: 'RENDERER_AI_DEVICE_LOST',
} as const

export type AiQualityTier = 'off' | 'low' | 'medium' | 'high' | 'ultra'

export interface AiPostProcessConfig {
  readonly interpolation?: 'off' | 'auto' | 'target-60' | 'target-120'
  readonly superResolution?: 'off' | 'auto' | 'x2'
  readonly maxTier?: AiQualityTier
  readonly frameBudgetRatio?: number
  readonly allowDegradation?: boolean
}

export interface MXPlayerOptions {
  target: string | HTMLElement
  source: SourceDescriptor
  intent?: PlaybackIntent
  wasmBaseUrl?: string
  aiModelBaseUrl?: string
  aiPostProcess?: AiPostProcessConfig
  autoplay?: boolean
}

