export type SourceDescriptor =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string; headers?: Record<string, string> }

/** A half-open byte range `[start, endExclusive)` from the source start. */
export interface ByteRange {
  /** Inclusive byte offset. */
  start: number
  /** Exclusive byte offset. */
  endExclusive: number
}

/** Bytes and source validators returned by one exact range read. */
export interface RangeReadResult {
  data: Uint8Array
  /** Total source length in bytes, or null when the remote total is unknown. */
  sourceLength: number | null
  contentRange: string | null
  etag: string | null
}

/** Retry counts and delays. `maxRetries` excludes the initial attempt. */
export interface RetryPolicy {
  maxRetries: number
  /** Initial retry delay in milliseconds. */
  baseDelayMs: number
  /** Maximum retry delay in milliseconds. */
  maxDelayMs: number
}

/** Exact cache identity for a source generation and half-open byte range. */
export interface RangeCacheKey {
  sourceKey: string
  range: ByteRange
  etag: string | null
}

export interface RangeCache {
  get(key: RangeCacheKey): RangeReadResult | null
  set(key: RangeCacheKey, value: RangeReadResult): void
  deleteSource(sourceKey: string): void
  clear(): void
}

export interface RangeLoaderOptions {
  signal?: AbortSignal
  retry?: RetryPolicy
  cache?: RangeCache
}

export type TrackKind = 'video' | 'audio' | 'subtitle'

/** Normalized browser platform family used for diagnostics and scoring hints. */
export type OperatingSystem = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown'

/** Result of validating one concrete media capability. */
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown'

/** Microsecond timestamps as integers. See docs/architecture/overview.md §5. */
export type Micros = number

export type PlaybackIntent = 'normal' | 'frame-access' | 'filters' | 'editing' | 'low-power' | 'ai-enhance'

export type NativeCrossOrigin = 'anonymous' | 'use-credentials' | null

export type NativePreload = 'none' | 'metadata' | 'auto'

export interface NativeMediaOptions {
  crossOrigin?: NativeCrossOrigin
  preload?: NativePreload
  playsInline?: boolean
  /** Metadata wait timeout in milliseconds. Defaults to 15,000 ms. */
  metadataTimeoutMs?: number
}

export interface NativeMediaFeatures {
  fullscreen: boolean
  pictureInPicture: boolean
  requestVideoFrameCallback: boolean
  fastSeek: boolean
}

export interface NativePlaybackStats {
  presentedFrames: number
  droppedFrames: number | null
  mediaTime: Micros | null
  lastCallbackTime: Micros | null
}

/** Bounded video-only decoding controls for the Phase 4 custom pipeline. */
export interface CustomVideoOptions {
  /** Maximum decoded frames owned by the pipeline, including decoder reservations. Defaults to 8. */
  maxDecodedFrames?: number
  /** Maximum number of chunks submitted to VideoDecoder. Defaults to 8. */
  maxDecodeQueueSize?: number
  /** Queue depth at or below which a paused decode pump may resume. Defaults to 3. */
  lowWaterMark?: number
  /** Maximum queued and reserved frame duration in integer microseconds. Defaults to 1,000,000. */
  maxBufferedDuration?: Micros
  /** Worker/configure/flush/seek operation timeout in milliseconds. Defaults to 10,000. */
  operationTimeoutMs?: number
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software'
  optimizeForLatency?: boolean
  /** Preferred presentation backend. `auto` tries WebGPU, WebGL2, then Canvas2D. */
  renderer?: VideoRendererPreference
  /** Crop, rotation, fit, and output-density controls applied by the renderer. */
  render?: VideoTransformOptions
  /** Fixed, bounded color filter applied by the renderer. */
  filter?: VideoFilterOptions
  /** Request HDR preservation. A renderer only reports success after end-to-end confirmation. */
  preserveHdr?: boolean
}

export type VideoRendererPreference = 'auto' | 'webgpu' | 'webgl2' | 'canvas2d'
export type CustomRendererKind = Exclude<RendererKind, 'native'>
export type VideoFilterKind = 'none' | 'grayscale' | 'brightness' | 'contrast' | 'saturate'
export type VideoRotation = 0 | 90 | 180 | 270
export type VideoFit = 'contain' | 'cover' | 'fill'

export interface VideoCropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface VideoTransformOptions {
  crop?: VideoCropRect
  rotation?: VideoRotation
  fit?: VideoFit
  /** Override the output CSS width in pixels. Both output dimensions must be supplied together. */
  outputWidth?: number
  /** Override the output CSS height in pixels. Both output dimensions must be supplied together. */
  outputHeight?: number
  /** Override `window.devicePixelRatio`. Valid values are finite and greater than zero. */
  devicePixelRatio?: number
}

export type VideoFilterOptions =
  | { kind: 'none' }
  | { kind: 'grayscale'; amount?: number }
  | { kind: 'brightness'; amount?: number }
  | { kind: 'contrast'; amount?: number }
  | { kind: 'saturate'; amount?: number }

export type RendererState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'lost'
  | 'rebuilding'
  | 'fallback'
  | 'error'
  | 'closed'

export type RendererColorMode = 'sdr-bt709' | 'sdr-srgb' | 'hdr' | 'unknown'
export type RendererColorRange = 'full' | 'limited' | 'unknown'

export interface RendererCapabilities {
  kind: CustomRendererKind
  available: boolean
  filters: readonly VideoFilterKind[]
  maxTextureDimension2d: number
  externalTexture: boolean
  hdr: boolean
  lossRecovery: boolean
}

export interface RendererStats {
  kind: CustomRendererKind
  state: RendererState
  presentedFrames: number
  droppedFrames: number
  waitFrames: number
  invalidFrames: number
  fallbackCount: number
  width: number
  height: number
  devicePixelRatio: number
  colorMode: RendererColorMode
  colorRange: RendererColorRange
  hdrPreserved: boolean
  hdrReason: string | null
  filter: VideoFilterKind
}

/**
 * A decoded frame whose ownership has transferred to the caller.
 * The caller must invoke `frame.close()` exactly once.
 */
export interface DecodedVideoFrame {
  frame: VideoFrame
  timestamp: Micros
  duration: Micros | null
  epoch: number
}

/** GPU-resident frame exchanged between postprocess and a GPU-capable renderer. */
export interface GpuVideoFrame {
  readonly texture: GPUTexture
  readonly width: number
  readonly height: number
  readonly timestamp: Micros
  readonly epoch?: number
  /** Return the texture to its bounded pool exactly once. */
  readonly release: () => void
}

export interface CustomVideoStats {
  decodedFrames: number
  deliveredFrames: number
  droppedFrames: number
  droppedStaleFrames: number
  droppedPreSeekFrames: number
  queuedFrames: number
  decodeQueueSize: number
  bufferedDuration: Micros
  endOfStream: boolean
}

export type AudioLatencyHint = 'interactive' | 'balanced' | 'playback' | number

/** Bounded custom-audio controls. All duration fields use integer microseconds. */
export interface CustomAudioOptions {
  /** Maximum compressed chunks submitted to AudioDecoder. Defaults to 16. */
  maxDecodeQueueSize?: number
  /** Maximum decoded PCM duration retained by the output path. Defaults to 2,000,000 us. */
  maxBufferedDuration?: Micros
  /** Decode/feed resumes at or below this buffered duration. Defaults to 500,000 us. */
  lowWaterMark?: Micros
  /** Output starts after this duration is buffered, or at EOS. Defaults to 150,000 us. */
  startBufferDuration?: Micros
  /** Maximum transferable PCM blocks awaiting MessagePort acknowledgement. Defaults to 8. */
  maxMessagePortPendingBlocks?: number
  /** AudioDecoder/AudioWorklet operation timeout. Defaults to 10,000 ms. */
  operationTimeoutMs?: number
  /** Forwarded to AudioContext. Numeric values are seconds. Defaults to `interactive`. */
  latencyHint?: AudioLatencyHint
  /** Optional AudioContext output sample rate. Valid range is 8,000-192,000 Hz. */
  outputSampleRate?: number
}

export type AudioOutputState =
  | 'uninitialized'
  | 'ready'
  | 'buffering'
  | 'running'
  | 'paused'
  | 'drained'
  | 'closed'

export type AudioTransportKind = 'shared-array-buffer' | 'message-port' | 'none'

export interface CustomAudioStats {
  decodedBlocks: number
  decodedFrames: number
  renderedFrames: number
  droppedStaleBlocks: number
  droppedPreSeekFrames: number
  underruns: number
  overflows: number
  decodeQueueSize: number
  bufferedFrames: number
  bufferedDuration: Micros
  inputSampleRate: number | null
  outputSampleRate: number | null
  channels: number | null
  pendingMessageBlocks: number
  transport: AudioTransportKind
  outputState: AudioOutputState
  endOfStream: boolean
}

export interface AudioClockSnapshot {
  source: 'audio-context' | 'wall-clock'
  mediaTime: Micros
  contextTime: Micros | null
  renderedFrames: number
  sampleRate: number | null
  playbackRate: number
  running: boolean
  underrun: boolean
  epoch: number
}

export type VideoFrameScheduleAction = 'wait' | 'present' | 'drop'

export interface VideoFrameScheduleDecision {
  action: VideoFrameScheduleAction
  drift: Micros
  wait: Micros
}

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

/** One compressed container packet. No decoding has been performed. */
export interface DemuxPacket {
  trackId: number
  kind: TrackKind
  /** Presentation timestamp in integer microseconds. */
  timestamp: Micros
  /** Packet duration in integer microseconds, or null when absent. */
  duration: Micros | null
  keyframe: boolean
  data: Uint8Array
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

export type SubtitleFormat = 'srt' | 'ass' | 'ssa'
export type SubtitleSourceKind = 'embedded' | 'file' | 'url'
export type SubtitleTrackState = 'idle' | 'loading' | 'ready' | 'selected' | 'disabled' | 'error'
export type SubtitleState = 'disabled' | 'idle' | 'loading' | 'ready' | 'showing' | 'ended' | 'error' | 'closed'
export type SubtitleDiagnosticSeverity = 'warning' | 'error'
export type SubtitleAlignment =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export const SubtitleErrorCodes = {
  SUBTITLE_INPUT_INVALID: 'SUBTITLE_INPUT_INVALID',
  SUBTITLE_INPUT_TOO_LARGE: 'SUBTITLE_INPUT_TOO_LARGE',
  SUBTITLE_LINE_TOO_LONG: 'SUBTITLE_LINE_TOO_LONG',
  SUBTITLE_CUE_LIMIT_EXCEEDED: 'SUBTITLE_CUE_LIMIT_EXCEEDED',
  SUBTITLE_TIME_INVALID: 'SUBTITLE_TIME_INVALID',
  SUBTITLE_PARSE_BUDGET_EXCEEDED: 'SUBTITLE_PARSE_BUDGET_EXCEEDED',
  SUBTITLE_SRT_INVALID: 'SUBTITLE_SRT_INVALID',
  SUBTITLE_ASS_INVALID: 'SUBTITLE_ASS_INVALID',
  SUBTITLE_ASS_UNSUPPORTED_FEATURE: 'SUBTITLE_ASS_UNSUPPORTED_FEATURE',
  SUBTITLE_FORMAT_UNSUPPORTED: 'SUBTITLE_FORMAT_UNSUPPORTED',
  SUBTITLE_SOURCE_INVALID: 'SUBTITLE_SOURCE_INVALID',
  SUBTITLE_SOURCE_CONFLICT: 'SUBTITLE_SOURCE_CONFLICT',
  SUBTITLE_SOURCE_UNSUPPORTED: 'SUBTITLE_SOURCE_UNSUPPORTED',
  SUBTITLE_SOURCE_TOO_LARGE: 'SUBTITLE_SOURCE_TOO_LARGE',
  SUBTITLE_CORS_FAILED: 'SUBTITLE_CORS_FAILED',
  SUBTITLE_NETWORK_FAILED: 'SUBTITLE_NETWORK_FAILED',
  SUBTITLE_ABORTED: 'SUBTITLE_ABORTED',
  SUBTITLE_PACKET_INVALID: 'SUBTITLE_PACKET_INVALID',
  SUBTITLE_TRACK_ID_CONFLICT: 'SUBTITLE_TRACK_ID_CONFLICT',
  SUBTITLE_TRACK_NOT_FOUND: 'SUBTITLE_TRACK_NOT_FOUND',
  SUBTITLE_TRACK_REMOVE_FORBIDDEN: 'SUBTITLE_TRACK_REMOVE_FORBIDDEN',
  SUBTITLE_OVERLAY_UNAVAILABLE: 'SUBTITLE_OVERLAY_UNAVAILABLE',
  SUBTITLE_OVERLAY_INVALID: 'SUBTITLE_OVERLAY_INVALID',
  SUBTITLE_STYLE_INVALID: 'SUBTITLE_STYLE_INVALID',
  SUBTITLE_STORE_FAILED: 'SUBTITLE_STORE_FAILED',
  SUBTITLE_OPERATION_FAILED: 'SUBTITLE_OPERATION_FAILED',
  SUBTITLE_CLOSED: 'SUBTITLE_CLOSED',
} as const

export type SubtitleErrorCode = (typeof SubtitleErrorCodes)[keyof typeof SubtitleErrorCodes]

export interface SubtitleCueStyle {
  /** Validated CSS font-family stack. */
  fontFamily?: string
  /** CSS pixel size. */
  fontSize?: number
  /** Validated hexadecimal color. */
  color?: string
  /** Validated hexadecimal outline color. */
  outlineColor?: string
  /** CSS pixel outline width. */
  outlineWidth?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  alignment?: SubtitleAlignment
  /** Horizontal percentage within the overlay, from 0 through 100. */
  x?: number
  /** Vertical percentage within the overlay, from 0 through 100. */
  y?: number
}

export interface SubtitleCue {
  cueId: string
  trackId: string
  start: Micros
  end: Micros
  text: string
  layer: number
  style?: SubtitleCueStyle
}

export interface SubtitleCueMetadata {
  cueId: string
  start: Micros
  end: Micros
  layer: number
}

export interface SubtitleDiagnostic {
  code: SubtitleErrorCode
  severity: SubtitleDiagnosticSeverity
  message: string
  line?: number
  cueId?: string
}

export type ExternalSubtitleSourceDescriptor =
  | { kind: 'file'; file: File; format?: SubtitleFormat }
  | { kind: 'url'; url: string; format?: SubtitleFormat }

export type SubtitleSourceDescriptor =
  | { kind: 'embedded'; trackId: number; format?: SubtitleFormat }
  | ExternalSubtitleSourceDescriptor

/** A safe source summary. It never contains a File object or complete URL. */
export interface SubtitleTrackSource {
  kind: SubtitleSourceKind
  format: SubtitleFormat
  embeddedTrackId?: number
}

export interface SubtitleTrack {
  id: string
  source: SubtitleTrackSource
  format: SubtitleFormat
  language: string | null
  name: string
  state: SubtitleTrackState
  cueCount: number
  diagnosticCount: number
}

export interface SubtitleTrackOptions {
  id?: string
  language?: string
  name?: string
}

export interface SubtitleParserLimits {
  maxInputBytes: number
  maxLineLength: number
  maxLines: number
  maxCues: number
  maxCueTextLength: number
  maxDiagnostics: number
  parseBudgetMs: number
}

export interface SubtitleParserLimitsInput {
  maxInputBytes?: number
  maxLineLength?: number
  maxLines?: number
  maxCues?: number
  maxCueTextLength?: number
  maxDiagnostics?: number
  parseBudgetMs?: number
}

export interface SubtitleSourceLimits {
  maxResponseBytes: number
  maxResponseChunks: number
  maxPacketBatches: number
  operationTimeoutMs: number
}

export interface SubtitleSourceLimitsInput {
  maxResponseBytes?: number
  maxResponseChunks?: number
  maxPacketBatches?: number
  operationTimeoutMs?: number
}

export interface SubtitleParseResult {
  cues: SubtitleCue[]
  diagnostics: SubtitleDiagnostic[]
}

export type SubtitleClockSource = 'native-media' | 'audio-context' | 'wall-clock'

export interface SubtitleClockSnapshot {
  source: SubtitleClockSource
  mediaTime: Micros
  playbackRate: number
  playing: boolean
  ended: boolean
  epoch: number
}

export interface SubtitleStyleStore {
  load(scope: string): SubtitleCueStyle
  save(scope: string, style: SubtitleCueStyle): void
  clear?(scope: string): void
}

export interface SubtitleOptions {
  enabled?: boolean
  overlayHost?: HTMLElement
  defaultTrackId?: string
  parserLimits?: SubtitleParserLimitsInput
  sourceLimits?: SubtitleSourceLimitsInput
  styleStore?: SubtitleStyleStore
}

export type SubtitleTrackChangeReason = 'enumerated' | 'added' | 'selected' | 'disabled' | 'removed' | 'loaded' | 'failed'

export interface EngineError {
  code: string
  message: string
  cause?: unknown
  recoverable: boolean
}

export type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'seeking' | 'ended' | 'error' | 'closed'

export interface PlaybackTimeRange {
  readonly start: Micros
  readonly end: Micros
}

export type PresentationMode = 'inline' | 'fullscreen' | 'picture-in-picture'

export interface PlaybackControlCapabilities {
  readonly seek: boolean
  readonly volume: boolean
  readonly playbackRate: boolean
  readonly fullscreen: boolean
  readonly pictureInPicture: boolean
  readonly preview: boolean
}

export interface PlaybackErrorSummary {
  readonly code: string
  readonly recoverable: boolean
}

export interface PlaybackSnapshot {
  readonly sessionEpoch: number
  readonly state: PlaybackState
  readonly paused: boolean
  readonly currentTime: Micros | null
  readonly duration: Micros | null
  readonly played: readonly PlaybackTimeRange[]
  readonly buffered: readonly PlaybackTimeRange[]
  readonly bufferedAhead: Micros
  readonly volume: number
  readonly muted: boolean
  readonly playbackRate: number
  readonly seeking: boolean
  readonly buffering: boolean
  readonly presentationMode: PresentationMode
  readonly capabilities: PlaybackControlCapabilities
  readonly lastError: PlaybackErrorSummary | null
}

export type PlaybackChangeReason =
  | 'load'
  | 'state'
  | 'time'
  | 'buffer'
  | 'volume'
  | 'rate'
  | 'presentation'
  | 'capabilities'
  | 'error'

export interface MediaPreviewRequest {
  readonly time: Micros
  readonly width?: number
  readonly height?: number
  readonly signal?: AbortSignal
}

export interface MediaPreviewProviderRequest {
  readonly time: Micros
  readonly width: number
  readonly height: number
  readonly duration: Micros | null
  readonly sessionEpoch: number
  readonly signal: AbortSignal
}

export interface MediaPreviewProviderResult {
  readonly blob: Blob
  readonly time: Micros
  readonly width: number
  readonly height: number
}

export type MediaPreviewProvider = (
  request: MediaPreviewProviderRequest,
) => Promise<MediaPreviewProviderResult | null>

export interface MediaPreviewImage extends MediaPreviewProviderResult {
  readonly sessionEpoch: number
}

export interface MediaPreviewOptions {
  readonly provider?: MediaPreviewProvider
}

/** Stable event payloads shared by core, SDK, and optional UI adapters. */
export interface EngineEventMap {
  ready: { selection: PlaybackSelection }
  statechange: { previous: PlaybackState; current: PlaybackState }
  timeupdate: { currentTime: Micros; duration: Micros | null }
  buffering: { bufferedAhead: Micros }
  backendchange: { previous: BackendCandidate | null; current: BackendCandidate; reason: string }
  capabilities: { context: CapabilityContext }
  qualitychange: { previous: AiQualityTier; current: AiQualityTier; reasons: readonly string[] }
  /** Notification only. VideoFrame ownership is transferred exclusively by readVideoFrame(). */
  frameavailable: { queuedFrames: number; bufferedDuration: Micros }
  audiostatechange: { state: AudioOutputState; stats: CustomAudioStats }
  audiounderrun: { count: number; bufferedDuration: Micros }
  clockupdate: { clock: AudioClockSnapshot }
  rendererchange: { previous: CustomRendererKind | null; current: CustomRendererKind; reason: string }
  rendererstatechange: { kind: CustomRendererKind; previous: RendererState; current: RendererState; reason: string | null }
  rendererstats: { stats: RendererStats }
  subtitletrackchange: { tracks: readonly SubtitleTrack[]; selectedTrackId: string | null; reason: SubtitleTrackChangeReason }
  subtitlecuechange: { trackId: string | null; cues: readonly SubtitleCueMetadata[]; currentTime: Micros; epoch: number }
  subtitlestatechange: { previous: SubtitleState; current: SubtitleState; trackId: string | null }
  subtitlestylechange: { style: SubtitleCueStyle }
  subtitlewarning: { trackId: string | null; diagnostic: SubtitleDiagnostic }
  playbackchange: { snapshot: PlaybackSnapshot; reason: PlaybackChangeReason }
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
  ENGINE_CLOSED: 'ENGINE_CLOSED',
  ENGINE_INVALID_TARGET: 'ENGINE_INVALID_TARGET',
  NATIVE_SOURCE_INVALID: 'NATIVE_SOURCE_INVALID',
  NATIVE_CUSTOM_HEADERS_UNSUPPORTED: 'NATIVE_CUSTOM_HEADERS_UNSUPPORTED',
  NATIVE_BACKEND_UNAVAILABLE: 'NATIVE_BACKEND_UNAVAILABLE',
  NATIVE_NOT_SUPPORTED: 'NATIVE_NOT_SUPPORTED',
  NATIVE_METADATA_TIMEOUT: 'NATIVE_METADATA_TIMEOUT',
  NATIVE_NETWORK_FAILED: 'NATIVE_NETWORK_FAILED',
  NATIVE_CORS_FAILED: 'NATIVE_CORS_FAILED',
  NATIVE_DECODE_FAILED: 'NATIVE_DECODE_FAILED',
  NATIVE_ABORTED: 'NATIVE_ABORTED',
  NATIVE_AUTOPLAY_BLOCKED: 'NATIVE_AUTOPLAY_BLOCKED',
  NATIVE_INVALID_TIME: 'NATIVE_INVALID_TIME',
  NATIVE_INVALID_RATE: 'NATIVE_INVALID_RATE',
  NATIVE_INVALID_VOLUME: 'NATIVE_INVALID_VOLUME',
  NATIVE_FULLSCREEN_UNSUPPORTED: 'NATIVE_FULLSCREEN_UNSUPPORTED',
  NATIVE_FULLSCREEN_BLOCKED: 'NATIVE_FULLSCREEN_BLOCKED',
  NATIVE_PIP_UNSUPPORTED: 'NATIVE_PIP_UNSUPPORTED',
  NATIVE_PIP_BLOCKED: 'NATIVE_PIP_BLOCKED',
  NATIVE_OPERATION_FAILED: 'NATIVE_OPERATION_FAILED',
  CUSTOM_BACKEND_UNAVAILABLE: 'CUSTOM_BACKEND_UNAVAILABLE',
  CUSTOM_VIDEO_TRACK_REQUIRED: 'CUSTOM_VIDEO_TRACK_REQUIRED',
  CUSTOM_FRAME_ACCESS_UNAVAILABLE: 'CUSTOM_FRAME_ACCESS_UNAVAILABLE',
  CUSTOM_INVALID_QUEUE_CONFIG: 'CUSTOM_INVALID_QUEUE_CONFIG',
  CUSTOM_SEEK_FAILED: 'CUSTOM_SEEK_FAILED',
  CUSTOM_OPERATION_FAILED: 'CUSTOM_OPERATION_FAILED',
  CUSTOM_AUDIO_BACKEND_UNAVAILABLE: 'CUSTOM_AUDIO_BACKEND_UNAVAILABLE',
  CUSTOM_AUDIO_TRACK_INVALID: 'CUSTOM_AUDIO_TRACK_INVALID',
  AUDIO_CONTEXT_UNAVAILABLE: 'AUDIO_CONTEXT_UNAVAILABLE',
  AUDIO_AUTOPLAY_BLOCKED: 'AUDIO_AUTOPLAY_BLOCKED',
  AUDIO_WORKLET_UNAVAILABLE: 'AUDIO_WORKLET_UNAVAILABLE',
  AUDIO_WORKLET_LOAD_FAILED: 'AUDIO_WORKLET_LOAD_FAILED',
  AUDIO_WORKLET_FAILED: 'AUDIO_WORKLET_FAILED',
  AUDIO_INVALID_QUEUE_CONFIG: 'AUDIO_INVALID_QUEUE_CONFIG',
  AUDIO_BUFFER_OVERFLOW: 'AUDIO_BUFFER_OVERFLOW',
  AUDIO_CHANNEL_LAYOUT_UNSUPPORTED: 'AUDIO_CHANNEL_LAYOUT_UNSUPPORTED',
  AUDIO_RESAMPLE_FAILED: 'AUDIO_RESAMPLE_FAILED',
  AUDIO_OPERATION_FAILED: 'AUDIO_OPERATION_FAILED',
  WEBCODECS_AUDIO_API_UNAVAILABLE: 'WEBCODECS_AUDIO_API_UNAVAILABLE',
  WEBCODECS_AUDIO_CONFIG_INVALID: 'WEBCODECS_AUDIO_CONFIG_INVALID',
  WEBCODECS_AUDIO_NOT_SUPPORTED: 'WEBCODECS_AUDIO_NOT_SUPPORTED',
  WEBCODECS_AUDIO_CONFIGURE_FAILED: 'WEBCODECS_AUDIO_CONFIGURE_FAILED',
  WEBCODECS_AUDIO_DECODE_FAILED: 'WEBCODECS_AUDIO_DECODE_FAILED',
  WEBCODECS_AUDIO_FLUSH_FAILED: 'WEBCODECS_AUDIO_FLUSH_FAILED',
  WEBCODECS_AUDIO_RESET_FAILED: 'WEBCODECS_AUDIO_RESET_FAILED',
  WEBCODECS_AUDIO_ABORTED: 'WEBCODECS_AUDIO_ABORTED',
  WEBCODECS_AUDIO_DATA_INVALID: 'WEBCODECS_AUDIO_DATA_INVALID',
  WEBCODECS_API_UNAVAILABLE: 'WEBCODECS_API_UNAVAILABLE',
  WEBCODECS_CONFIG_INVALID: 'WEBCODECS_CONFIG_INVALID',
  WEBCODECS_NOT_SUPPORTED: 'WEBCODECS_NOT_SUPPORTED',
  WEBCODECS_CONFIGURE_FAILED: 'WEBCODECS_CONFIGURE_FAILED',
  WEBCODECS_DECODE_FAILED: 'WEBCODECS_DECODE_FAILED',
  WEBCODECS_FLUSH_FAILED: 'WEBCODECS_FLUSH_FAILED',
  WEBCODECS_RESET_FAILED: 'WEBCODECS_RESET_FAILED',
  WEBCODECS_ABORTED: 'WEBCODECS_ABORTED',
  WEBCODECS_QUEUE_OVERFLOW: 'WEBCODECS_QUEUE_OVERFLOW',
  WEBCODECS_FRAME_INVALID: 'WEBCODECS_FRAME_INVALID',
  WEBCODECS_WORKER_FAILED: 'WEBCODECS_WORKER_FAILED',
  CAPABILITY_API_UNAVAILABLE: 'CAPABILITY_API_UNAVAILABLE',
  CAPABILITY_INVALID_CONFIG: 'CAPABILITY_INVALID_CONFIG',
  CAPABILITY_PROBE_FAILED: 'CAPABILITY_PROBE_FAILED',
  CAPABILITY_CACHE_FAILED: 'CAPABILITY_CACHE_FAILED',
  STRATEGY_NO_VIABLE_BACKEND: 'STRATEGY_NO_VIABLE_BACKEND',
  STRATEGY_INVALID_PLATFORM_ADJUSTMENT: 'STRATEGY_INVALID_PLATFORM_ADJUSTMENT',
  RANGE_INVALID: 'RANGE_INVALID',
  RANGE_UNSUPPORTED: 'RANGE_UNSUPPORTED',
  RANGE_CONTENT_RANGE_INVALID: 'RANGE_CONTENT_RANGE_INVALID',
  RANGE_RESPONSE_LENGTH_MISMATCH: 'RANGE_RESPONSE_LENGTH_MISMATCH',
  RANGE_CORS_FAILED: 'RANGE_CORS_FAILED',
  RANGE_NETWORK_FAILED: 'RANGE_NETWORK_FAILED',
  RANGE_ABORTED: 'RANGE_ABORTED',
  RANGE_RETRY_EXHAUSTED: 'RANGE_RETRY_EXHAUSTED',
  RANGE_CLOSED: 'RANGE_CLOSED',
  RANGE_REDIRECTED: 'RANGE_REDIRECTED',
  RANGE_HEADER_INVALID: 'RANGE_HEADER_INVALID',
  RANGE_HTTP_STATUS: 'RANGE_HTTP_STATUS',
  RANGE_SOURCE_CHANGED: 'RANGE_SOURCE_CHANGED',
  CONTAINER_UNSUPPORTED: 'CONTAINER_UNSUPPORTED',
  CONTAINER_TRUNCATED: 'CONTAINER_TRUNCATED',
  CONTAINER_INVALID: 'CONTAINER_INVALID',
  CONTAINER_LIMIT_EXCEEDED: 'CONTAINER_LIMIT_EXCEEDED',
  RENDERER_AI_UNSUPPORTED: 'RENDERER_AI_UNSUPPORTED',
  RENDERER_BACKEND_UNAVAILABLE: 'RENDERER_BACKEND_UNAVAILABLE',
  RENDERER_TARGET_INVALID: 'RENDERER_TARGET_INVALID',
  RENDERER_CONTEXT_UNAVAILABLE: 'RENDERER_CONTEXT_UNAVAILABLE',
  RENDERER_DEVICE_REQUEST_FAILED: 'RENDERER_DEVICE_REQUEST_FAILED',
  RENDERER_DEVICE_LOST: 'RENDERER_DEVICE_LOST',
  RENDERER_DEVICE_REBUILD_FAILED: 'RENDERER_DEVICE_REBUILD_FAILED',
  RENDERER_SHADER_FAILED: 'RENDERER_SHADER_FAILED',
  RENDERER_FRAME_INVALID: 'RENDERER_FRAME_INVALID',
  RENDERER_RESIZE_INVALID: 'RENDERER_RESIZE_INVALID',
  RENDERER_FILTER_UNSUPPORTED: 'RENDERER_FILTER_UNSUPPORTED',
  RENDERER_HDR_UNSUPPORTED: 'RENDERER_HDR_UNSUPPORTED',
  RENDERER_OPERATION_FAILED: 'RENDERER_OPERATION_FAILED',
  RENDERER_CLOSED: 'RENDERER_CLOSED',
  RENDERER_AI_MODEL_LOAD_FAILED: 'RENDERER_AI_MODEL_LOAD_FAILED',
  RENDERER_AI_MODEL_HASH_MISMATCH: 'RENDERER_AI_MODEL_HASH_MISMATCH',
  RENDERER_AI_PIPELINE_FAILED: 'RENDERER_AI_PIPELINE_FAILED',
  RENDERER_AI_BUDGET_EXCEEDED: 'RENDERER_AI_BUDGET_EXCEEDED',
  RENDERER_AI_DEVICE_LOST: 'RENDERER_AI_DEVICE_LOST',
  PREVIEW_INPUT_INVALID: 'PREVIEW_INPUT_INVALID',
  ...SubtitleErrorCodes,
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
  native?: NativeMediaOptions
  customVideo?: CustomVideoOptions
  customAudio?: CustomAudioOptions
  subtitles?: SubtitleOptions
  preview?: MediaPreviewOptions
}

export interface MediaEngine extends EngineEventSource {
  readonly state: PlaybackState
  readonly media: MediaDescriptor | null
  readonly selection: PlaybackSelection | null
  readonly nativeFeatures: NativeMediaFeatures | null
  readonly nativeStats: NativePlaybackStats | null
  readonly customVideoStats: CustomVideoStats | null
  readonly customAudioStats: CustomAudioStats | null
  readonly audioClock: AudioClockSnapshot | null
  readonly rendererKind: CustomRendererKind | null
  readonly rendererState: RendererState | null
  readonly rendererStats: RendererStats | null
  readonly subtitleTracks: readonly SubtitleTrack[]
  readonly selectedSubtitleTrack: string | null
  readonly subtitleState: SubtitleState
  readonly subtitleStyle: SubtitleCueStyle
  readonly playback: PlaybackSnapshot

  load(options: MXPlayerOptions): Promise<void>
  play(): Promise<void>
  pause(): void
  seek(time: Micros): Promise<void>
  setPlaybackRate(rate: number): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  setVideoFilter(filter: VideoFilterOptions): Promise<void>
  setVideoTransform(transform: VideoTransformOptions): void
  listSubtitleTracks(): readonly SubtitleTrack[]
  addSubtitleTrack(source: ExternalSubtitleSourceDescriptor, options?: SubtitleTrackOptions): Promise<SubtitleTrack>
  selectSubtitleTrack(trackId: string | null): Promise<void>
  removeSubtitleTrack(trackId: string): void
  closeSubtitles(): void
  setSubtitleStyle(style: SubtitleCueStyle): void
  resetSubtitleStyle(): void
  attachSubtitleOverlay(host?: HTMLElement): void
  detachSubtitleOverlay(): void
  readVideoFrame(): Promise<DecodedVideoFrame | null>
  requestPreview(request: MediaPreviewRequest): Promise<MediaPreviewImage | null>
  requestFullscreen(): Promise<void>
  exitFullscreen(): Promise<void>
  requestPictureInPicture(): Promise<void>
  exitPictureInPicture(): Promise<void>
  close(): void
}

