import type {
  CapabilitySnapshot,
  CustomRendererKind,
  EngineError,
  RendererCapabilities,
  RendererColorMode,
  RendererColorRange,
  RendererState,
  RendererStats,
  VideoFilterKind,
  VideoFilterOptions,
  VideoRendererPreference,
  VideoTransformOptions,
} from '@mx-player-max/types'

/**
 * The renderer receives ownership of a frame passed to `render`. It closes that
 * frame exactly once after upload/draw, including failed, stale, or closed paths.
 * A frame returned by `readVideoFrame` is not renderer-owned until passed here.
 */
export interface VideoRenderer {
  readonly kind: import('@mx-player-max/types').RendererKind
  attach(target: HTMLCanvasElement | HTMLVideoElement): Promise<void>
  render(frame: VideoFrame): void
  resize(width: number, height: number): void
  close(): void
}

export interface RendererFactory {
  canCreate(kind: import('@mx-player-max/types').RendererKind): boolean
  create(kind: import('@mx-player-max/types').RendererKind): VideoRenderer
}

export interface ManagedVideoRenderer extends VideoRenderer {
  readonly kind: CustomRendererKind
  readonly state: RendererState
  readonly stats: RendererStats
  readonly capabilities: RendererCapabilities
  setFilter(filter: VideoFilterOptions): void
  setTransform(transform: VideoTransformOptions): void
  /** Called by Core when the scheduler waits or drops a frame. */
  noteSchedule(action: 'wait' | 'drop'): void
}

export type RendererEvent =
  | { type: 'state'; kind: CustomRendererKind; previous: RendererState; current: RendererState; reason: string | null }
  | { type: 'error'; kind: CustomRendererKind; error: EngineError }
  | { type: 'fallback'; previous: CustomRendererKind; current: CustomRendererKind; reason: string }
  | { type: 'stats'; stats: RendererStats }

export type RendererEventHandler = (event: RendererEvent) => void

export interface RendererRuntime {
  readonly gpu?: GPU
  getDevicePixelRatio?(): number
  createWebGL2Context?(canvas: HTMLCanvasElement): WebGL2RenderingContext | null
  createCanvas2DContext?(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null
}

export interface RendererFactoryOptions {
  /** Selected preference for injected factories; BrowserRendererFactory uses the preference passed to createRenderer. */
  preference?: VideoRendererPreference
  capabilities?: CapabilitySnapshot
  runtime?: RendererRuntime
  onEvent?: RendererEventHandler
  filter?: VideoFilterOptions
  transform?: VideoTransformOptions
  preserveHdr?: boolean
}

export interface GpuTextureRenderer extends VideoRenderer {
  readonly device: GPUDevice
  renderTexture(texture: GPUTexture, width: number, height: number): void
}

export { RendererException, rendererError, isRendererError, publicRendererError } from './errors'
export type { RendererErrorCode } from './errors'
export { Canvas2DRenderer } from './canvas2d'
export { WebGL2Renderer } from './webgl2'
export { WebGPURenderer } from './webgpu'
export { ManagedRenderer, BrowserRendererFactory, createRenderer } from './factory'
export { MAX_CANVAS_DIMENSION, normalizeFilter, normalizeTransform, validateFrame, validateResize } from './validation'
export type { NormalizedFilter, ResolvedTransform, ValidatedFrame } from './validation'

export type { RendererCapabilities, RendererColorMode, RendererColorRange, RendererState, RendererStats, VideoFilterKind, VideoRendererPreference }
