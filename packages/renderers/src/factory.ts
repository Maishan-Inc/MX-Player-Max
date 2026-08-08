import type {
  CustomRendererKind, RendererCapabilities, RendererKind, RendererStats, RendererState, VideoFilterOptions,
  VideoRendererPreference, VideoTransformOptions, GpuVideoFrame,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { type RendererBackendOptions } from './base'
import { Canvas2DRenderer } from './canvas2d'
import { publicRendererError, rendererError } from './errors'
import type { ManagedVideoRenderer, RendererFactory, RendererFactoryOptions, VideoRenderer } from './index'
import { WebGL2Renderer } from './webgl2'
import { WebGPURenderer } from './webgpu'

export class BrowserRendererFactory implements RendererFactory {
  readonly #options: RendererFactoryOptions

  constructor(options: RendererFactoryOptions = {}) { this.#options = options }

  canCreate(kind: RendererKind): boolean {
    if (kind === 'native') return false
    if (kind === 'webgpu') return this.#options.capabilities?.webGpu ?? this.hasGpu()
    if (kind === 'webgl2') return this.#options.capabilities?.webGl2 ?? this.hasWebgl()
    return this.#options.capabilities?.canvas2d ?? this.hasCanvas()
  }

  create(kind: RendererKind, onEvent?: RendererFactoryOptions['onEvent']): VideoRenderer {
    if (!this.canCreate(kind)) {
      throw rendererError(ErrorCodes.RENDERER_BACKEND_UNAVAILABLE, `The requested ${kind} renderer is unavailable`, true)
    }
    return createBackend(kind as CustomRendererKind, onEvent === undefined ? this.#options : { ...this.#options, onEvent })
  }

  private hasGpu(): boolean {
    return Boolean(this.#options.runtime?.gpu ?? (typeof navigator !== 'undefined' ? navigator.gpu : undefined))
  }

  private hasWebgl(): boolean {
    if (this.#options.runtime?.createWebGL2Context) return true
    if (typeof document === 'undefined') return false
    try { return Boolean(document.createElement('canvas').getContext('webgl2')) } catch { return false }
  }

  private hasCanvas(): boolean {
    if (this.#options.runtime?.createCanvas2DContext) return true
    if (typeof document === 'undefined') return false
    try { return Boolean(document.createElement('canvas').getContext('2d')) } catch { return false }
  }
}

export class ManagedRenderer implements ManagedVideoRenderer {
  #backend: ManagedVideoRenderer
  readonly #preference: VideoRendererPreference
  readonly #factory: BrowserRendererFactory
  readonly #options: RendererFactoryOptions
  readonly #targetEvents: RendererFactoryOptions['onEvent']
  #target: HTMLCanvasElement | HTMLVideoElement | null = null
  #closed = false
  #fallbackCount = 0
  #fallbackTask: Promise<void> | null = null
  #filter: VideoFilterOptions
  #transform: VideoTransformOptions

  constructor(preference: VideoRendererPreference = 'auto', options: RendererFactoryOptions = {}) {
    this.#preference = preference
    this.#options = options
    this.#targetEvents = options.onEvent
    this.#filter = options.filter ?? { kind: 'none' }
    this.#transform = options.transform ?? {}
    this.#factory = new BrowserRendererFactory(options)
    this.#backend = this.#factory.create(this.select(preference), (event) => this.handleBackendEvent(event)) as ManagedVideoRenderer
  }

  get kind(): CustomRendererKind { return this.#backend.kind }
  get state(): RendererState { return this.#backend.state }
  get stats(): RendererStats { return { ...this.#backend.stats, fallbackCount: this.#fallbackCount } }
  get capabilities(): RendererCapabilities { return this.#backend.capabilities }
  get device(): GPUDevice {
    const device = (this.#backend as ManagedVideoRenderer & { device?: GPUDevice }).device
    if (!device) throw rendererError(ErrorCodes.RENDERER_BACKEND_UNAVAILABLE, 'The active renderer has no GPU device', true)
    return device
  }

  async attach(target: HTMLCanvasElement | HTMLVideoElement): Promise<void> {
    this.ensureOpen()
    this.#target = target
    try {
      await this.#backend.attach(target)
    } catch (cause) {
      if (this.#closed) throw rendererError(ErrorCodes.RENDERER_CLOSED, 'The renderer was closed during initialization', false)
      if (this.#preference !== 'auto') throw cause
      await this.fallback(cause)
    }
  }

  render(frame: VideoFrame): void {
    if (this.#closed) { this.#backend.render(frame); return }
    try {
      this.#backend.render(frame)
    } catch (cause) {
      if (isLossError(cause)) this.scheduleFallback(cause)
      else throw cause
    }
  }

  resize(width: number, height: number): void { this.ensureOpen(); this.#backend.resize(width, height) }
  setFilter(filter: VideoFilterOptions): void { this.ensureOpen(); this.#filter = filter; this.#backend.setFilter(filter) }
  setTransform(transform: VideoTransformOptions): void { this.ensureOpen(); this.#transform = transform; this.#backend.setTransform(transform) }
  noteSchedule(action: 'wait' | 'drop'): void { if (!this.#closed) this.#backend.noteSchedule(action) }
  renderTexture(frame: GpuVideoFrame): void {
    const renderer = this.#backend as ManagedVideoRenderer & { renderTexture?: (value: GpuVideoFrame) => void }
    if (!renderer.renderTexture) {
      frame.release()
      throw rendererError(ErrorCodes.RENDERER_BACKEND_UNAVAILABLE, 'The active renderer does not accept GPU frames', true)
    }
    renderer.renderTexture(frame)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#target = null
    this.#backend.close()
  }

  private async fallback(cause: unknown): Promise<void> {
    if (this.#closed) return
    const target = this.#target
    if (!target) throw cause
    const previous = this.#backend.kind
    const next = this.select('auto', previous)
    const replacement = this.#factory.create(next, (event) => this.handleBackendEvent(event)) as ManagedVideoRenderer
    replacement.setFilter(this.#filter)
    replacement.setTransform(this.#transform)
    try {
      await replacement.attach(target)
    } catch (replacementCause) {
      replacement.close()
      if (next === 'canvas2d') throw replacementCause
      this.#backend.close()
      this.#backend = replacement
      await this.fallback(replacementCause)
      return
    }
    if (this.#closed) {
      replacement.close()
      return
    }
    this.#backend.close()
    this.#backend = replacement
    this.#fallbackCount += 1
    this.#targetEvents?.({ type: 'fallback', previous, current: next, reason: errorCode(cause) })
  }

  private handleBackendEvent(event: Parameters<NonNullable<RendererFactoryOptions['onEvent']>>[0]): void {
    if (this.#closed) return
    if (event.type === 'stats') this.#targetEvents?.({ type: 'stats', stats: { ...event.stats, fallbackCount: this.#fallbackCount } })
    else this.#targetEvents?.(event)
    if (event.type === 'error' && isLossError(event.error)) this.scheduleFallback(event.error)
  }

  private scheduleFallback(cause: unknown): void {
    if (this.#closed || this.#fallbackTask !== null || this.#target === null) return
    this.#fallbackTask = this.fallback(cause).catch((error: unknown) => {
      if (!this.#closed) {
        const normalized = error instanceof Error && 'code' in error
          ? error as Error & { code: string; message: string; recoverable: boolean }
          : rendererError(ErrorCodes.RENDERER_OPERATION_FAILED, 'Renderer fallback failed', true, error)
        this.#targetEvents?.({ type: 'error', kind: this.kind, error: publicRendererError(normalized) })
      }
    }).finally(() => { this.#fallbackTask = null })
  }

  private select(preference: VideoRendererPreference, excluded?: CustomRendererKind): CustomRendererKind {
    const candidates: CustomRendererKind[] = preference === 'auto' ? ['webgpu', 'webgl2', 'canvas2d'] : [preference]
    const start = excluded === undefined ? 0 : candidates.indexOf(excluded) + 1
    const selected = candidates.slice(start).find((kind) => this.#factory.canCreate(kind))
    if (!selected) throw rendererError(ErrorCodes.RENDERER_BACKEND_UNAVAILABLE, 'No requested renderer backend is available', true)
    return selected
  }

  private ensureOpen(): void {
    if (this.#closed) throw rendererError(ErrorCodes.RENDERER_CLOSED, 'The renderer is closed', false)
  }
}

export function createRenderer(preference: VideoRendererPreference = 'auto', options: RendererFactoryOptions = {}): ManagedRenderer {
  return new ManagedRenderer(preference, options)
}

function createBackend(kind: CustomRendererKind, options: RendererFactoryOptions): ManagedVideoRenderer {
  const backendOptions: RendererBackendOptions = {
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.filter === undefined ? {} : { filter: options.filter }),
    ...(options.transform === undefined ? {} : { transform: options.transform }),
    ...(options.preserveHdr === undefined ? {} : { preserveHdr: options.preserveHdr }),
    ...(options.capabilities?.webGpuFeatures.maxTextureDimension2d
      ? { maxTextureDimension2d: options.capabilities.webGpuFeatures.maxTextureDimension2d }
      : {}),
  }
  if (kind === 'webgpu') return new WebGPURenderer(backendOptions)
  if (kind === 'webgl2') return new WebGL2Renderer(backendOptions)
  return new Canvas2DRenderer(backendOptions)
}

function errorCode(value: unknown): string {
  return typeof value === 'object' && value !== null && 'code' in value
    ? String((value as { code?: unknown }).code)
    : ErrorCodes.RENDERER_OPERATION_FAILED
}

function isLossError(value: unknown): boolean {
  const code = errorCode(value)
  return code === ErrorCodes.RENDERER_CONTEXT_UNAVAILABLE
    || code === ErrorCodes.RENDERER_DEVICE_REBUILD_FAILED
}
