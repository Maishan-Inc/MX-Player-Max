import type { RendererKind } from '@mx-player-max/types'

export interface VideoRenderer {
  readonly kind: RendererKind
  attach(target: HTMLCanvasElement | HTMLVideoElement): Promise<void>
  render(frame: VideoFrame): void
  resize(width: number, height: number): void
  close(): void
}

export interface RendererFactory {
  canCreate(kind: RendererKind): boolean
  create(kind: RendererKind): VideoRenderer
}

/**
 * Additive interface for renderers that can present a GPU texture directly.
 *
 * The AI post-processing chain produces GPU-resident frames; a renderer
 * implementing this can accept them without a round trip through
 * `VideoFrame`, saving one copy per frame.
 *
 * `VideoRenderer` itself is unchanged — renderers opt in.
 */
export interface GpuTextureRenderer extends VideoRenderer {
  readonly device: GPUDevice
  renderTexture(texture: GPUTexture, width: number, height: number): void
}

