import type { RendererCapabilities } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { BaseRenderer, FILTERS, type RendererBackendOptions } from './base'
import { rendererError } from './errors'
import type { ValidatedFrame } from './validation'

export class Canvas2DRenderer extends BaseRenderer {
  readonly kind = 'canvas2d' as const
  private context: CanvasRenderingContext2D | null = null

  get capabilities(): RendererCapabilities {
    return { kind: this.kind, available: this.context !== null, filters: FILTERS, maxTextureDimension2d: this.maxDimension, externalTexture: false, hdr: false, lossRecovery: false }
  }

  constructor(options: RendererBackendOptions = {}) { super(options) }

  protected async initialize(): Promise<void> {
    const canvas = this.requireCanvas()
    const context = this.runtime.createCanvas2DContext?.(canvas) ?? canvas.getContext('2d')
    if (!context) throw rendererError(ErrorCodes.RENDERER_CONTEXT_UNAVAILABLE, 'Canvas2D is unavailable for the renderer target', true)
    this.context = context
  }

  protected draw(frame: VideoFrame, validated: ValidatedFrame): void {
    const context = this.context
    const canvas = this.requireCanvas()
    if (!context) throw rendererError(ErrorCodes.RENDERER_CONTEXT_UNAVAILABLE, 'The Canvas2D context is unavailable', true)
    const crop = this.transform.crop ?? { x: 0, y: 0, width: validated.width, height: validated.height }
    const rotation = this.transform.rotation
    context.save()
    try {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.filter = cssFilter(this.filter.kind, this.filter.amount)
      context.translate(canvas.width / 2, canvas.height / 2)
      context.rotate(rotation * Math.PI / 180)
      const rotated = rotation === 90 || rotation === 270
      const boundsWidth = rotated ? canvas.height : canvas.width
      const boundsHeight = rotated ? canvas.width : canvas.height
      const target = fitRect(crop.width, crop.height, boundsWidth, boundsHeight, this.transform.fit)
      context.drawImage(frame, crop.x, crop.y, crop.width, crop.height, -target.width / 2, -target.height / 2, target.width, target.height)
    } finally { context.restore() }
  }

  protected resizeBackend(_width: number, _height: number): void { /* backing size is set by BaseRenderer */ }
  protected release(): void { this.context = null }
}

function cssFilter(kind: string, amount: number): string {
  switch (kind) {
    case 'none': return 'none'
    case 'grayscale': return `grayscale(${amount})`
    case 'brightness': return `brightness(${amount})`
    case 'contrast': return `contrast(${amount})`
    case 'saturate': return `saturate(${amount})`
    default: throw rendererError(ErrorCodes.RENDERER_FILTER_UNSUPPORTED, 'The Canvas2D filter is unsupported', false)
  }
}

function fitRect(sourceWidth: number, sourceHeight: number, width: number, height: number, fit: 'contain' | 'cover' | 'fill'): { width: number; height: number } {
  if (fit === 'fill') return { width, height }
  const scale = fit === 'cover' ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight)
  return { width: sourceWidth * scale, height: sourceHeight * scale }
}
