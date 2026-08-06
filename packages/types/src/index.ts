export type SourceDescriptor =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string; headers?: Record<string, string> }

export type TrackKind = 'video' | 'audio' | 'subtitle'

export type PlaybackIntent = 'normal' | 'frame-access' | 'filters' | 'editing' | 'low-power'

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

export interface PlaybackSelection {
  backend: BackendCandidate
  intent: PlaybackIntent
  capabilities: CapabilitySnapshot
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

export interface MXPlayerOptions {
  target: string | HTMLElement
  source: SourceDescriptor
  intent?: PlaybackIntent
  wasmBaseUrl?: string
  autoplay?: boolean
}

