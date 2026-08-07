import type { DemuxPacket, EngineError } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type { VideoDecoderAdapterCallbacks, VideoDecoderAdapterLike } from './contracts'
import { createWebCodecsError } from './errors'
import { VideoDecoderAdapter } from './video-decoder-adapter'
import type { DecoderWorkerRequest, DecoderWorkerResponse } from './worker-protocol'

export interface DecoderWorkerPort {
  postMessage(message: DecoderWorkerResponse, transfer?: Transferable[]): void
}

export type DecoderAdapterFactory = (callbacks: VideoDecoderAdapterCallbacks) => VideoDecoderAdapterLike

export interface VideoDecoderWorkerControllerOptions {
  createAdapter?: DecoderAdapterFactory
}

interface PendingFrameIdentity {
  requestId: string
  epoch: number
}

export class VideoDecoderWorkerController {
  readonly #port: DecoderWorkerPort
  readonly #createAdapter: DecoderAdapterFactory
  readonly #pendingFrames = new Map<number, PendingFrameIdentity[]>()
  #adapter: VideoDecoderAdapterLike | null = null
  #sessionId: string | null = null
  #epoch = 0
  #lastRequestId = 'decoder'
  #closed = false

  constructor(port: DecoderWorkerPort, options: VideoDecoderWorkerControllerOptions = {}) {
    this.#port = port
    this.#createAdapter = options.createAdapter ?? ((callbacks) => new VideoDecoderAdapter({ callbacks }))
  }

  async handle(request: DecoderWorkerRequest): Promise<void> {
    if (!validIdentity(request)) {
      this.#postError(request, createWebCodecsError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'Decoder Worker message identity is invalid', false))
      return
    }
    if (request.command === 'configure') {
      await this.#configure(request)
      return
    }
    if (request.command === 'close') {
      this.#close(request)
      return
    }
    if (request.command === 'reset') {
      if (this.#closed || request.sessionId !== this.#sessionId || request.epoch <= this.#epoch || !this.#adapter) return
      this.#epoch = request.epoch
      this.#lastRequestId = request.requestId
      this.#pendingFrames.clear()
      try {
        await this.#adapter.reset(request.epoch)
        if (!this.#isCurrent(request)) return
        this.#port.postMessage({ type: 'reset', ...identity(request) })
      } catch (cause) {
        if (this.#isCurrent(request)) this.#postError(request, toEngineError(cause, ErrorCodes.WEBCODECS_RESET_FAILED, 'Decoder Worker reset failed'))
      }
      return
    }
    if (this.#closed || request.sessionId !== this.#sessionId || request.epoch !== this.#epoch || !this.#adapter) return
    this.#lastRequestId = request.requestId
    if (request.command === 'decode') {
      this.#decode(request.packet, request)
      return
    }
    if (request.command === 'flush') {
      try {
        await this.#adapter.flush(request.epoch)
        if (!this.#isCurrent(request)) return
        this.#port.postMessage({ type: 'flushed', ...identity(request) })
      } catch (cause) {
        if (this.#isCurrent(request)) this.#postError(request, toEngineError(cause, ErrorCodes.WEBCODECS_FLUSH_FAILED, 'Decoder Worker flush failed'))
      }
      return
    }
  }

  close(): void {
    this.#adapter?.close()
    this.#adapter = null
    this.#pendingFrames.clear()
    this.#closed = true
    this.#sessionId = null
  }

  async #configure(request: Extract<DecoderWorkerRequest, { command: 'configure' }>): Promise<void> {
    if (this.#sessionId !== null && request.sessionId !== this.#sessionId) this.close()
    this.#closed = false
    this.#sessionId = request.sessionId
    this.#epoch = request.epoch
    this.#lastRequestId = request.requestId
    this.#pendingFrames.clear()
    try {
      if (!this.#adapter) {
        this.#adapter = this.#createAdapter({
          onFrame: (frame, epoch) => this.#onFrame(frame, epoch),
          onError: (error, epoch) => this.#onAdapterError(error, epoch),
          onDequeue: (epoch) => this.#onDequeue(epoch),
        })
      }
      await this.#adapter.configure(request.config, request.supported, request.epoch)
      if (!this.#isCurrent(request)) return
      this.#port.postMessage({ type: 'configured', ...identity(request) })
    } catch (cause) {
      if (this.#isCurrent(request)) this.#postError(request, toEngineError(cause, ErrorCodes.WEBCODECS_CONFIGURE_FAILED, 'Decoder Worker configuration failed'))
    }
  }

  #decode(packet: DemuxPacket, request: Extract<DecoderWorkerRequest, { command: 'decode' }>): void {
    const pending = this.#pendingFrames.get(packet.timestamp) ?? []
    pending.push({ requestId: request.requestId, epoch: request.epoch })
    this.#pendingFrames.set(packet.timestamp, pending)
    try {
      this.#adapter?.decode(packet, request.epoch)
    } catch (cause) {
      pending.pop()
      if (pending.length === 0) this.#pendingFrames.delete(packet.timestamp)
      this.#postError(request, toEngineError(cause, ErrorCodes.WEBCODECS_DECODE_FAILED, 'Decoder Worker decode failed'))
    }
  }

  #onFrame(frame: VideoFrame, epoch: number): void {
    if (this.#closed || this.#sessionId === null || epoch !== this.#epoch) {
      closeFrame(frame)
      return
    }
    const timestamp = safeMicros(frame.timestamp)
    const duration = frame.duration === null ? null : safeMicros(frame.duration)
    if (timestamp === null || (frame.duration !== null && duration === null)) {
      closeFrame(frame)
      this.#postError({ sessionId: this.#sessionId, epoch, requestId: this.#lastRequestId }, createWebCodecsError(ErrorCodes.WEBCODECS_FRAME_INVALID, 'Decoder Worker produced an invalid frame', false))
      return
    }
    const matches = this.#pendingFrames.get(timestamp)
    const match = matches?.shift()
    if (matches && matches.length === 0) this.#pendingFrames.delete(timestamp)
    if (!match || match.epoch !== epoch) {
      closeFrame(frame)
      return
    }
    this.#port.postMessage({
      type: 'frame',
      sessionId: this.#sessionId,
      epoch,
      requestId: match.requestId,
      frame,
      timestamp,
      duration,
    }, [frame])
  }

  #onDequeue(epoch: number): void {
    if (this.#closed || this.#sessionId === null || epoch !== this.#epoch) return
    this.#port.postMessage({
      type: 'dequeue',
      sessionId: this.#sessionId,
      epoch,
      requestId: this.#lastRequestId,
      decodeQueueSize: this.#adapter?.decodeQueueSize ?? 0,
    })
  }

  #onAdapterError(error: EngineError, epoch: number): void {
    if (this.#closed || this.#sessionId === null || epoch !== this.#epoch) return
    this.#postError({ sessionId: this.#sessionId, epoch, requestId: this.#lastRequestId }, error)
  }

  #close(request: Extract<DecoderWorkerRequest, { command: 'close' }>): void {
    if (request.sessionId === this.#sessionId) this.close()
    this.#port.postMessage({ type: 'closed', ...identity(request) })
  }

  #postError(request: { sessionId: string; epoch: number; requestId: string }, error: EngineError): void {
    this.#port.postMessage({ type: 'error', ...identity(request), error: sanitizeError(error) })
  }

  #isCurrent(request: { sessionId: string; epoch: number }): boolean {
    return !this.#closed && request.sessionId === this.#sessionId && request.epoch === this.#epoch
  }
}

function identity(value: { sessionId: string; epoch: number; requestId: string }) {
  return { sessionId: value.sessionId, epoch: value.epoch, requestId: value.requestId }
}

function validIdentity(value: { sessionId: string; epoch: number; requestId: string }): boolean {
  return value.sessionId.length > 0 && value.requestId.length > 0 && Number.isSafeInteger(value.epoch) && value.epoch >= 0
}

function sanitizeError(error: EngineError): EngineError {
  return { code: error.code, message: error.message, recoverable: error.recoverable }
}

function toEngineError(cause: unknown, code: string, message: string): EngineError {
  if (typeof cause === 'object' && cause !== null
    && 'code' in cause && typeof cause.code === 'string'
    && 'message' in cause && typeof cause.message === 'string'
    && 'recoverable' in cause && typeof cause.recoverable === 'boolean') {
    return cause as EngineError
  }
  return createWebCodecsError(code, message, true, cause)
}

function safeMicros(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function closeFrame(frame: VideoFrame): void {
  try { frame.close() } catch { /* best effort for an invalid frame */ }
}
