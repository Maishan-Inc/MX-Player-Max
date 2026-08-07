export type SourceDescriptor =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string; headers?: Record<string, string> }

export type TrackKind = 'video' | 'audio' | 'subtitle'

/** Normalized browser platform family used for diagnostics and scoring hints. */
export type OperatingSystem = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown'

/** Result of validating one concrete media capability. */
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown'

/** Microsecond timestamps as integers. See docs/architecture/overview.md §5. */
export type Micros = number

export type PlaybackIntent = 'normal' | 'frame-access' | 'filters' | 'editing' | 'low-power' | 'ai-enhance'

/** 色彩原色。决定色域范围。 */
export type ColorPrimaries = 'bt709' | 'bt2020' | 'p3' | 'bt601' | 'unknown'

/**
 * 传输函数（EOTF）。SDR 与 HDR 的真正分界线。
 * pq 为绝对亮度映射（流媒体/蓝光），hlg 为相对亮度映射（广播，SDR 部分兼容）。
 */
export type TransferFunction = 'bt1886' | 'srgb' | 'pq' | 'hlg' | 'unknown'

/** 矩阵系数。nc = non-constant luminance，c = constant luminance。 */
export type MatrixCoefficients = 'bt709' | 'bt601' | 'bt2020nc' | 'bt2020c' | 'unknown'

export type HdrFormat = 'none' | 'hdr10' | 'hdr10plus' | 'hlg' | 'dolby-vision'

/**
 * Dolby Vision Profile。兼容性差别极大，必须显式区分：
 * - 5：单层 IPT-PQ-c2，忽略 RPU 会导致画面严重偏色（解码成功但结果错误）
 * - 7：双层 BL+EL+RPU，基础层 HDR10 兼容
 * - 8.1：单层，基础层即合规 HDR10，可安全降级
 */
export type DolbyVisionProfile = 4 | 5 | 7 | 8 | 9

/** ST 2086 母版显示元数据。色度坐标为 CIE 1931 xy，亮度单位 nits。 */
export interface MasteringDisplayMetadata {
  redPrimary?: readonly [number, number]
  greenPrimary?: readonly [number, number]
  bluePrimary?: readonly [number, number]
  whitePoint?: readonly [number, number]
  maxLuminance?: number
  minLuminance?: number
}

/** CTA-861.3 内容光度级别，单位 nits。 */
export interface ContentLightLevel {
  /** 最大内容光度级别 */
  maxCLL?: number
  /** 最大帧平均光度级别 */
  maxFALL?: number
}

/**
 * 结构化色彩描述。
 * HDR 需要位深、传输函数、色域三者同时成立；8-bit 无法承载 HDR（会产生色带）。
 */
export interface ColorInfo {
  bitDepth?: 8 | 10 | 12
  primaries?: ColorPrimaries
  transfer?: TransferFunction
  matrix?: MatrixCoefficients
  /** 全范围（0-255）或有限范围（16-235） */
  fullRange?: boolean
  hdrFormat?: HdrFormat
  /** 仅当 hdrFormat 为 dolby-vision 时有意义。Profile 5 需拒绝或警告。 */
  dolbyVisionProfile?: DolbyVisionProfile
  masteringDisplay?: MasteringDisplayMetadata
  contentLightLevel?: ContentLightLevel
}

/** 对象音频格式。本身不是 Codec，是承载在 carrier 码流中的元数据层。 */
export type AudioObjectFormat = 'none' | 'atmos' | 'dtsx'

/** 对象音频的载体 Codec。WebCodecs AudioDecoder 均不支持这些格式。 */
export type AudioObjectCarrier = 'ec-3' | 'truehd' | 'ac-4' | 'dts-hd'

/**
 * 对象音频描述。
 * 探测到并不代表能渲染——Web 平台无对象渲染器，也无 bitstream 透传 API，
 * 自定义管线下必然降混为 bedLayout 声道布局。
 */
export interface AudioObjectInfo {
  format?: AudioObjectFormat
  carrier?: AudioObjectCarrier
  /** 核心床布局，如 '5.1'、'7.1' */
  bedLayout?: string
  objectCount?: number
}

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
  bitrate?: number
  profile?: string
  level?: string
  /** @deprecated 使用 `color.bitDepth`。保留以兼容既有读取方。 */
  bitDepth?: number
  /** @deprecated 使用 `color.primaries` / `color.transfer` / `color.matrix`。 */
  colorSpace?: string
  /** @deprecated 使用 `color.hdrFormat`。boolean 无法区分 Dolby Vision Profile 5 与 8.1。 */
  hdr?: boolean
  /** 结构化色彩与 HDR 描述。 */
  color?: ColorInfo
  sampleRate?: number
  channels?: number
  /** 对象音频（Atmos / DTS:X）描述。 */
  audioObjects?: AudioObjectInfo
}

export interface MediaDescriptor {
  container: string
  tracks: TrackInfo[]
  duration: Micros | null
  size: number | null
  mimeType: string | null
}

/** Browser-independent video configuration used to build WebCodecs requests. */
export interface VideoCodecConfig {
  codec: string
  codedWidth?: number
  codedHeight?: number
  displayWidth?: number
  displayHeight?: number
  bitrate?: number
  framerate?: number
  description?: ArrayBuffer
}

/** Browser-independent audio configuration used to build WebCodecs requests. */
export interface AudioCodecConfig {
  codec: string
  sampleRate?: number
  numberOfChannels?: number
  bitrate?: number
  description?: ArrayBuffer
}

export interface MediaCapabilityQuery {
  container: string
  mimeType: string | null
  video: VideoCodecConfig | null
  audio: AudioCodecConfig | null
}

export interface CapabilityResult {
  status: CapabilitySupport
  reasons: readonly string[]
}

export interface DecodingCapabilityInfo {
  supported: boolean
  smooth: boolean
  powerEfficient: boolean
}

export interface NativeTrackCapability extends CapabilityResult {
  contentType: string | null
  canPlayType: '' | 'maybe' | 'probably'
  decodingInfo?: DecodingCapabilityInfo
}

export interface WebCodecsCapability extends CapabilityResult {
  configPresent: boolean
}

export interface MediaCapabilityReport {
  schemaVersion: number
  query: MediaCapabilityQuery
  native: {
    video: NativeTrackCapability
    audio: NativeTrackCapability
    playable: CapabilitySupport
    reasons: readonly string[]
  }
  webCodecs: {
    video: WebCodecsCapability
    audio: WebCodecsCapability
    playable: CapabilitySupport
    reasons: readonly string[]
  }
}

export interface WasmDecoderDeclaration {
  codec: string
  supportsVideo: boolean
  supportsAudio: boolean
  variants?: readonly ('single' | 'simd' | 'threaded')[]
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
  schemaVersion: number
  sdkVersion: string
  browser: 'chromium' | 'webkit' | 'gecko' | 'unknown'
  browserVersion: string | null
  platform: OperatingSystem
  crossOriginIsolated: boolean
  sharedArrayBuffer: boolean
  wasmSimd: boolean
  wasmThreads: boolean
  htmlVideo: boolean
  mediaCapabilities: boolean
  webCodecsVideo: boolean
  webCodecsAudio: boolean
  webGpu: boolean
  webGl2: boolean
  canvas2d: boolean
  workerMediaSource: boolean
  webGpuFeatures: WebGpuFeatureSnapshot
  quirks: string[]
}

export interface CapabilityContext {
  snapshot: CapabilitySnapshot
  media: MediaCapabilityReport
  wasmDecoders?: readonly WasmDecoderDeclaration[]
}

export type BackendKind = 'html-video' | 'webcodecs' | 'wasm' | 'mse'
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
  mediaCapabilities: MediaCapabilityReport
  aiPlan?: AiPlan
}

export interface PlatformScoreAdjustment {
  candidateId: string
  scoreDelta: number
  reasons: readonly string[]
}

export interface SubtitleCue {
  start: Micros
  end: Micros
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

export type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'seeking' | 'ended' | 'error' | 'closed'

/** Stable event payloads shared by core, SDK, and optional UI adapters. */
export interface EngineEventMap {
  ready: { selection: PlaybackSelection }
  statechange: { previous: PlaybackState; current: PlaybackState }
  timeupdate: { currentTime: Micros; duration: Micros | null }
  buffering: { bufferedAhead: Micros }
  backendchange: { previous: BackendCandidate | null; current: BackendCandidate; reason: string }
  capabilities: { context: CapabilityContext }
  qualitychange: { previous: AiQualityTier; current: AiQualityTier; reasons: readonly string[] }
  error: { error: EngineError }
}

export type EngineEventName = keyof EngineEventMap
export type EngineEventListener<K extends EngineEventName> = (payload: EngineEventMap[K]) => void

export interface EngineEventSource {
  on<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): () => void
  off<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): void
  once<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): () => void
}

/**
 * Known error codes. Projects extending the RENDERER_* namespace should keep
 * all AI-related failures under RENDERER_AI_* to avoid modifying the
 * cross-module error-code domain list in AGENTS.md §7.
 */
export const ErrorCodes = {
  CAPABILITY_API_UNAVAILABLE: 'CAPABILITY_API_UNAVAILABLE',
  CAPABILITY_INVALID_CONFIG: 'CAPABILITY_INVALID_CONFIG',
  CAPABILITY_PROBE_FAILED: 'CAPABILITY_PROBE_FAILED',
  CAPABILITY_CACHE_FAILED: 'CAPABILITY_CACHE_FAILED',
  STRATEGY_NO_VIABLE_BACKEND: 'STRATEGY_NO_VIABLE_BACKEND',
  STRATEGY_INVALID_PLATFORM_ADJUSTMENT: 'STRATEGY_INVALID_PLATFORM_ADJUSTMENT',
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

