import type {
  EngineError,
  MediaPreviewImage,
  MediaPreviewProvider,
  MediaPreviewProviderRequest,
  MediaPreviewRequest,
  Micros,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createEngineError } from '../native/errors'

export const PREVIEW_MAX_WIDTH = 320
export const PREVIEW_MAX_HEIGHT = 180
export const PREVIEW_MAX_PIXELS = 57_600
export const PREVIEW_MAX_BYTES = 512 * 1024
export const PREVIEW_TIMEOUT_MS = 2_500
export const PREVIEW_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface PreviewManagerOptions {
  readonly provider?: MediaPreviewProvider
  readonly epoch: number
  readonly duration: Micros | null
}

export class PreviewManager {
  #provider: MediaPreviewProvider | undefined
  #epoch: number
  #duration: Micros | null
  #closed = false
  #requestSequence = 0
  #activeAbort: AbortController | null = null

  constructor(options: PreviewManagerOptions) {
    this.#provider = options.provider
    this.#epoch = options.epoch
    this.#duration = options.duration
  }

  configure(options: PreviewManagerOptions): void {
    this.#abortActive()
    this.#provider = options.provider
    this.#epoch = options.epoch
    this.#duration = options.duration
  }

  get available(): boolean { return this.#provider !== undefined }

  request(request: MediaPreviewRequest): Promise<MediaPreviewImage | null> {
    if (this.#closed) return Promise.reject(createEngineError(ErrorCodes.ENGINE_CLOSED, 'The media engine is closed', false))
    let dimensions: { width: number; height: number }
    try { dimensions = validatePreviewRequest(request, this.#duration) }
    catch (error) { return Promise.reject(error) }
    const provider = this.#provider
    if (!provider) return Promise.resolve(null)
    const requestEpoch = this.#epoch
    const sequence = ++this.#requestSequence
    this.#abortActive()
    const controller = new AbortController()
    this.#activeAbort = controller
    const combined = combineSignals(controller.signal, request.signal)
    const signal = combined.signal
    const providerRequest: MediaPreviewProviderRequest = {
      time: request.time,
      width: dimensions.width,
      height: dimensions.height,
      duration: this.#duration,
      sessionEpoch: requestEpoch,
      signal,
    }
    if (signal.aborted) {
      combined.cleanup()
      if (this.#activeAbort === controller) this.#activeAbort = null
      return Promise.resolve(null)
    }
    let provided: Promise<Awaited<ReturnType<MediaPreviewProvider>>>
    try { provided = Promise.resolve(provider(providerRequest)) }
    catch {
      combined.cleanup()
      if (this.#activeAbort === controller) this.#activeAbort = null
      return Promise.resolve(null)
    }
    return withTimeout(provided, signal, PREVIEW_TIMEOUT_MS, () => controller.abort())
      .then((result) => {
        if (this.#closed || requestEpoch !== this.#epoch || sequence !== this.#requestSequence || signal.aborted) return null
        if (!result || !validatePreviewResult(result, requestEpoch, dimensions.width, dimensions.height)) return null
        return Object.freeze({ ...result, sessionEpoch: requestEpoch })
      })
      .catch(() => null)
      .finally(() => {
        combined.cleanup()
        if (this.#activeAbort === controller) this.#activeAbort = null
      })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#abortActive()
    this.#provider = undefined
    this.#epoch += 1
  }

  #abortActive(): void {
    this.#activeAbort?.abort()
    this.#activeAbort = null
  }
}

export function validatePreviewRequest(
  request: MediaPreviewRequest,
  duration: Micros | null,
): { width: number; height: number } {
  if (!request || !Number.isSafeInteger(request.time) || request.time < 0) throw previewInputError('Preview time must be a non-negative integer')
  if (duration !== null && request.time > duration) throw previewInputError('Preview time exceeds the media duration')
  const width = request.width === undefined ? 160 : request.width
  const height = request.height === undefined ? 90 : request.height
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0 || width > PREVIEW_MAX_WIDTH || height > PREVIEW_MAX_HEIGHT
    || width * height > PREVIEW_MAX_PIXELS) throw previewInputError('Preview dimensions are outside the supported range')
  return { width, height }
}

export function validatePreviewResult(
  result: { readonly blob: Blob; readonly time: Micros; readonly width: number; readonly height: number },
  epoch: number,
  width: number,
  height: number,
): boolean {
  if (!result || !result.blob || !PREVIEW_MIME_TYPES.has(result.blob.type.toLowerCase())) return false
  if (result.blob.size <= 0 || result.blob.size > PREVIEW_MAX_BYTES) return false
  if (!Number.isSafeInteger(result.time) || result.time < 0 || result.width !== width || result.height !== height) return false
  return Number.isSafeInteger(epoch) && epoch >= 0
}

function previewInputError(message: string): EngineError {
  return createEngineError(ErrorCodes.PREVIEW_INPUT_INVALID, message, false)
}

function combineSignals(primary: AbortSignal, secondary: AbortSignal | undefined): { signal: AbortSignal; cleanup: () => void } {
  if (!secondary) return { signal: primary, cleanup: () => {} }
  const controller = new AbortController()
  let listening = false
  const cleanup = (): void => {
    if (!listening) return
    listening = false
    primary.removeEventListener('abort', abort)
    secondary.removeEventListener('abort', abort)
  }
  const abort = (): void => {
    controller.abort()
    cleanup()
  }
  if (primary.aborted || secondary.aborted) controller.abort()
  else {
    listening = true
    primary.addEventListener('abort', abort, { once: true })
    secondary.addEventListener('abort', abort, { once: true })
  }
  return { signal: controller.signal, cleanup }
}

function withTimeout<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('preview-aborted')); return }
    let settled = false
    const timer = setTimeout(() => { onTimeout(); finish(new Error('preview-timeout')) }, timeoutMs)
    const abort = (): void => finish(new Error('preview-aborted'))
    const finish = (error?: unknown, value?: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error === undefined) resolve(value as T)
      else reject(error)
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then((value) => finish(undefined, value), (error) => finish(error))
  })
}
