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

