import type {
  CustomRendererKind, RendererCapabilities, RendererColorMode, RendererColorRange, RendererState, RendererStats,
  VideoFilterOptions, VideoTransformOptions,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type { ManagedVideoRenderer, RendererEventHandler, RendererRuntime } from './index'
import { publicRendererError, rendererError } from './errors'
import {
  MAX_CANVAS_DIMENSION, normalizeFilter, normalizeTransform, safeCloseFrame, validateFrame, validateResize,
  type NormalizedFilter, type ResolvedTransform, type ValidatedFrame,
} from './validation'

export const FILTERS = ['none', 'grayscale', 'brightness', 'contrast', 'saturate'] as const

export interface RendererBackendOptions {
  runtime?: RendererRuntime
  onEvent?: RendererEventHandler
  filter?: VideoFilterOptions
  transform?: VideoTransformOptions
  preserveHdr?: boolean
  maxTextureDimension2d?: number
}

export abstract class BaseRenderer implements ManagedVideoRenderer {
  abstract readonly kind: CustomRendererKind
  protected readonly runtime: RendererRuntime
  protected readonly onEvent: RendererEventHandler | undefined
  protected readonly preserveHdr: boolean
  protected canvas: HTMLCanvasElement | null = null
  protected filter: NormalizedFilter
  protected transform: ResolvedTransform
  protected maxDimension: number
  protected closed = false
  protected currentState: RendererState = 'uninitialized'
  protected presentedFrames = 0
  protected droppedFrames = 0
  protected waitFrames = 0
  protected invalidFrames = 0
  protected fallbackCount = 0
  protected width = 0
  protected height = 0
  protected dpr = 1
  protected colorMode: RendererColorMode = 'unknown'
  protected colorRange: RendererColorRange = 'unknown'
  protected hdrPreserved = false
  protected hdrReason: string | null = 'hdr-not-confirmed'
  private readonly acceptedFrames = new WeakSet<VideoFrame>()

  constructor(options: RendererBackendOptions = {}) {
    this.runtime = options.runtime ?? {}
    this.onEvent = options.onEvent
    this.preserveHdr = options.preserveHdr ?? false
    this.filter = normalizeFilter(options.filter)
    this.transform = normalizeTransform(options.transform)
    this.maxDimension = Math.min(MAX_CANVAS_DIMENSION, options.maxTextureDimension2d ?? MAX_CANVAS_DIMENSION)
  }

  get state(): RendererState { return this.currentState }
  get stats(): RendererStats {
    return {
      kind: this.kind, state: this.currentState, presentedFrames: this.presentedFrames, droppedFrames: this.droppedFrames,
      waitFrames: this.waitFrames, invalidFrames: this.invalidFrames, fallbackCount: this.fallbackCount,
      width: this.width, height: this.height, devicePixelRatio: this.dpr, colorMode: this.colorMode, colorRange: this.colorRange,
      hdrPreserved: this.hdrPreserved, hdrReason: this.hdrReason, filter: this.filter.kind,
    }
  }
  abstract get capabilities(): RendererCapabilities

  async attach(target: HTMLCanvasElement | HTMLVideoElement): Promise<void> {
    this.ensureOpen()
    if (!isCanvas(target)) throw rendererError(ErrorCodes.RENDERER_TARGET_INVALID, 'A custom renderer requires a canvas target', false)
    this.canvas = target
    this.transition('initializing', null)
    try {
      await this.initialize()
      if (this.closed) {
        throw rendererError(ErrorCodes.RENDERER_CLOSED, 'The renderer was closed during initialization', false)
      }
      this.applyInitialSize()
      this.transition('ready', null)
    } catch (cause) {
      try { this.release() } catch { /* best effort cleanup after a failed initialization */ }
      if (!this.closed) this.transition('error', 'initialization-failed')
      throw cause
    }
  }

  render(frame: VideoFrame): void {
    if (this.acceptedFrames.has(frame)) {
      throw rendererError(ErrorCodes.RENDERER_FRAME_INVALID, 'The same VideoFrame was submitted to a renderer more than once', false)
    }
    this.acceptedFrames.add(frame)
    if (this.closed || this.currentState !== 'ready') {
      safeCloseFrame(frame)
      if (!this.closed) this.droppedFrames += 1
      return
    }
    try {
      const validated = validateFrame(frame, this.transform)
      this.validateBackendFrame(validated)
      this.updateColor(validated)
      this.draw(frame, validated)
      this.presentedFrames += 1
      this.onEvent?.({ type: 'stats', stats: this.stats })
    } catch (cause) {
      this.invalidFrames += 1
      const error = cause instanceof Error && 'code' in cause
        ? cause as Error & { code: string; recoverable: boolean }
        : rendererError(ErrorCodes.RENDERER_OPERATION_FAILED, 'The VideoFrame could not be rendered', true, cause)
      this.onEvent?.({ type: 'error', kind: this.kind, error: publicRendererError(error) })
      throw error
    } finally {
      safeCloseFrame(frame)
    }
  }

  resize(width: number, height: number): void {
    this.ensureOpen()
    const dpr = this.resolveDpr()
    validateResize(width, height, dpr, this.maxDimension)
    const canvas = this.requireCanvas()
    this.width = width
    this.height = height
    this.dpr = dpr
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    if (canvas.style) { canvas.style.width = `${width}px`; canvas.style.height = `${height}px` }
    this.resizeBackend(canvas.width, canvas.height)
  }

  setFilter(filter: VideoFilterOptions): void { this.ensureOpen(); this.filter = normalizeFilter(filter) }
  setTransform(transform: VideoTransformOptions): void {
    this.ensureOpen()
    const previous = this.transform
    this.transform = normalizeTransform(transform)
    try { if (this.canvas) this.applyInitialSize() } catch (cause) { this.transform = previous; throw cause }
  }
  noteSchedule(action: 'wait' | 'drop'): void {
    if (this.closed) return
    if (action === 'wait') this.waitFrames += 1
    else this.droppedFrames += 1
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try { this.release() } finally { this.canvas = null; this.transition('closed', null) }
  }

  protected abstract initialize(): Promise<void>
  protected abstract draw(frame: VideoFrame, validated: ValidatedFrame): void
  protected abstract resizeBackend(width: number, height: number): void
  protected abstract release(): void
  protected validateBackendFrame(validated: ValidatedFrame): void {
    if (validated.width > this.maxDimension || validated.height > this.maxDimension) {
      throw rendererError(ErrorCodes.RENDERER_FRAME_INVALID, 'The VideoFrame exceeds the backend texture limit', false)
    }
  }
  protected transition(next: RendererState, reason: string | null): void {
    const previous = this.currentState
    if (previous === next) return
    this.currentState = next
    if (!this.closed || next === 'closed') this.onEvent?.({ type: 'state', kind: this.kind, previous, current: next, reason })
  }
  protected requireCanvas(): HTMLCanvasElement {
    if (!this.canvas) throw rendererError(ErrorCodes.RENDERER_TARGET_INVALID, 'The renderer has no canvas target', false)
    return this.canvas
  }
  protected ensureOpen(): void { if (this.closed) throw rendererError(ErrorCodes.RENDERER_CLOSED, 'The renderer is closed', false) }
  protected reportFatal(error: Error & { code: string; recoverable: boolean }): void {
    if (this.closed) return
    this.transition('error', error.code)
    this.onEvent?.({ type: 'error', kind: this.kind, error: publicRendererError(error) })
  }

  private applyInitialSize(): void {
    const canvas = this.requireCanvas()
    const sourceWidth = this.transform.outputWidth ?? canvas.clientWidth ?? canvas.width
    const sourceHeight = this.transform.outputHeight ?? canvas.clientHeight ?? canvas.height
    this.resize(sourceWidth > 0 ? sourceWidth : 1, sourceHeight > 0 ? sourceHeight : 1)
  }
  private resolveDpr(): number {
    if (this.transform.devicePixelRatio !== null) return this.transform.devicePixelRatio
    const value = this.runtime.getDevicePixelRatio?.() ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio)
    return Number.isFinite(value) && value > 0 ? Math.min(8, value) : 1
  }
  private updateColor(frame: ValidatedFrame): void {
    this.colorMode = frame.colorMode
    this.colorRange = frame.fullRange === null ? 'unknown' : frame.fullRange ? 'full' : 'limited'
    if (!frame.hdr) { this.hdrPreserved = false; this.hdrReason = null; return }
    this.hdrPreserved = this.preserveHdr && this.supportsHdr(frame)
    this.hdrReason = this.hdrPreserved ? null : `${this.kind}-hdr-not-confirmed`
  }
  protected supportsHdr(_frame: ValidatedFrame): boolean { return false }
}

function isCanvas(target: HTMLCanvasElement | HTMLVideoElement): target is HTMLCanvasElement {
  return typeof (target as { getContext?: unknown }).getContext === 'function'
    && typeof (target as { width?: unknown }).width === 'number'
    && typeof (target as { height?: unknown }).height === 'number'
}
