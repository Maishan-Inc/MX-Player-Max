import type {
  MediaPreviewImage,
  MediaPreviewProvider,
  MediaPreviewProviderRequest,
  MediaPreviewRequest,
  NativeMediaOptions,
  SourceDescriptor,
  Micros,
} from '@mx-player-max/types'
import { PreviewManager } from '../playback/preview-manager'

/**
 * Isolated native preview surface. The active playback element is never
 * touched; this service owns its own muted media element and canvas.
 */
export class NativePreviewController {
  readonly #manager: PreviewManager
  readonly #document: Document | null
  readonly #source: SourceDescriptor
  readonly #contentType: string
  readonly #options: NativeMediaOptions
  #video: HTMLVideoElement | null = null
  #canvas: HTMLCanvasElement | null = null
  #objectUrl: string | null = null
  #closed = false

  constructor(options: {
    readonly source: SourceDescriptor
    readonly contentType: string
    readonly native?: NativeMediaOptions
    readonly epoch: number
    readonly duration: Micros | null
    readonly ownerDocument?: Document | null
  }) {
    this.#source = options.source
    this.#contentType = options.contentType
    this.#options = options.native ?? {}
    this.#document = options.ownerDocument ?? (typeof document === 'undefined' ? null : document)
    this.#manager = new PreviewManager({ epoch: options.epoch, duration: options.duration, provider: (request) => this.#render(request) })
  }

  get available(): boolean { return this.#document !== null }

  request(request: MediaPreviewRequest): Promise<MediaPreviewImage | null> {
    return this.#manager.request(request)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#manager.close()
    if (this.#video) {
      try { this.#video.pause() } catch { /* best effort */ }
      try { this.#video.removeAttribute('src'); this.#video.load() } catch { /* best effort */ }
      this.#video.remove()
    }
    this.#video = null
    this.#canvas?.remove()
    this.#canvas = null
    if (this.#objectUrl !== null && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(this.#objectUrl) } catch { /* best effort */ }
    }
    this.#objectUrl = null
  }

  async #render(request: MediaPreviewProviderRequest): Promise<{ blob: Blob; time: Micros; width: number; height: number } | null> {
    if (this.#closed || !this.#document || request.signal.aborted) return null
    const video = this.#ensureVideo()
    const canvas = this.#ensureCanvas(request.width, request.height)
    try {
      await ensureMetadata(video, request.signal)
      if (request.signal.aborted) return null
      video.currentTime = request.time / 1_000_000
      await waitForSeek(video, request.signal)
      if (request.signal.aborted) return null
      const context = canvas.getContext('2d')
      if (!context) return null
      context.drawImage(video, 0, 0, request.width, request.height)
      const blob = await canvasToBlob(canvas, request.signal)
      return blob ? { blob, time: request.time, width: request.width, height: request.height } : null
    } catch {
      return null
    }
  }

  #ensureVideo(): HTMLVideoElement {
    if (this.#video) return this.#video
    if (!this.#document) throw new Error('preview-document-unavailable')
    const video = this.#document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.playsInline = true
    if (this.#source.kind === 'url') {
      video.crossOrigin = this.#options.crossOrigin ?? 'anonymous'
      video.src = this.#source.url
    } else {
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('preview-object-url-unavailable')
      this.#objectUrl = URL.createObjectURL(this.#source.file)
      video.src = this.#objectUrl
    }
    video.setAttribute('type', this.#contentType)
    video.load()
    this.#video = video
    return video
  }

  #ensureCanvas(width: number, height: number): HTMLCanvasElement {
    if (!this.#canvas) {
      if (!this.#document) throw new Error('preview-document-unavailable')
      this.#canvas = this.#document.createElement('canvas')
    }
    this.#canvas.width = width
    this.#canvas.height = height
    return this.#canvas
  }
}

async function ensurePromise(
  signal: AbortSignal,
  wait: (done: () => void, fail: (reason?: unknown) => void) => () => void,
): Promise<void> {
  if (signal.aborted) throw new Error('preview-aborted')
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let cleanup = (): void => {}
    const finish = (reason?: unknown): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      cleanup()
      if (reason === undefined) resolve()
      else reject(reason)
    }
    const abort = (): void => finish(new Error('preview-aborted'))
    signal.addEventListener('abort', abort, { once: true })
    cleanup = wait(() => finish(), (reason) => finish(reason))
    if (settled) cleanup()
  })
}

async function ensureMetadata(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (video.readyState >= 1) return
  await ensurePromise(signal, (done, fail) => {
    const onReady = (): void => done()
    const onError = (): void => fail(new Error('preview-load-failed'))
    const cleanup = (): void => {
      video.removeEventListener('loadedmetadata', onReady)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadedmetadata', onReady, { once: true })
    video.addEventListener('error', onError, { once: true })
    return cleanup
  })
}

async function waitForSeek(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (!video.seeking) return
  await ensurePromise(signal, (done, fail) => {
    const onSeeked = (): void => done()
    const onError = (): void => fail(new Error('preview-seek-failed'))
    const cleanup = (): void => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    return cleanup
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(null); return }
    canvas.toBlob((blob) => resolve(signal.aborted ? null : blob), 'image/webp', 0.82)
  })
}
