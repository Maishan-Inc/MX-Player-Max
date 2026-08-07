import type { DemuxPacket, EngineError } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type { VideoDecoderAdapterCallbacks, VideoDecoderAdapterLike } from './contracts'
import { createWebCodecsError } from './errors'
import type { DecoderWorkerRequest, DecoderWorkerResponse } from './worker-protocol'

export interface DecoderWorkerTransport {
  postMessage(message: DecoderWorkerRequest, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<DecoderWorkerResponse>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<DecoderWorkerResponse>) => void): void
  terminate?(): void
  close?(): void
  start?(): void
}

export type DecoderWorkerTransportFactory = () => DecoderWorkerTransport

export interface WorkerVideoDecoderAdapterOptions {
  callbacks: VideoDecoderAdapterCallbacks
  transportFactory?: DecoderWorkerTransportFactory
  sessionId?: string
  operationTimeoutMs?: number
}

interface PendingOperation {
  epoch: number
  expected: 'configured' | 'flushed' | 'reset'
  timer: ReturnType<typeof setTimeout>
  resolve(): void
  reject(reason: unknown): void
}

export class WorkerVideoDecoderAdapter implements VideoDecoderAdapterLike {
  readonly #callbacks: VideoDecoderAdapterCallbacks
  readonly #transport: DecoderWorkerTransport
  readonly #sessionId: string
  readonly #operationTimeoutMs: number
  readonly #pending = new Map<string, PendingOperation>()
  readonly #decodeRequests = new Set<string>()
  readonly #listener: (event: MessageEvent<DecoderWorkerResponse>) => void
  #requestSequence = 0
  #epoch = 0
  #decodeQueueSize = 0
  #closed = false

  constructor(options: WorkerVideoDecoderAdapterOptions) {
    this.#callbacks = options.callbacks
    this.#sessionId = options.sessionId ?? createSessionId()
    this.#operationTimeoutMs = validTimeout(options.operationTimeoutMs ?? 10_000)
    this.#transport = (options.transportFactory ?? createBrowserDecoderWorkerTransport)()
    this.#listener = (event) => this.#handleMessage(event.data)
    this.#transport.addEventListener('message', this.#listener)
    this.#transport.start?.()
  }

  get decodeQueueSize(): number { return this.#decodeQueueSize }

  configure(config: VideoDecoderConfig, supported: boolean, epoch: number): Promise<void> {
    this.#ensureOpen()
    this.#epoch = epoch
    return this.#control({ command: 'configure', config, supported, ...this.#nextIdentity(epoch) }, 'configured')
  }

  decode(packet: DemuxPacket, epoch: number): void {
    this.#ensureEpoch(epoch)
    const request: DecoderWorkerRequest = { command: 'decode', packet, ...this.#nextIdentity(epoch) }
    this.#transport.postMessage(request)
    this.#decodeRequests.add(request.requestId)
    this.#decodeQueueSize += 1
  }

  flush(epoch: number): Promise<void> {
    this.#ensureEpoch(epoch)
    return this.#control({ command: 'flush', ...this.#nextIdentity(epoch) }, 'flushed')
  }

  async reset(epoch: number): Promise<void> {
    this.#ensureOpen()
    this.#abortPending()
    this.#epoch = epoch
    this.#decodeQueueSize = 0
    this.#decodeRequests.clear()
    await this.#control({ command: 'reset', ...this.#nextIdentity(epoch) }, 'reset')
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    const request: DecoderWorkerRequest = { command: 'close', ...this.#nextIdentity(this.#epoch + 1) }
    try { this.#transport.postMessage(request) } catch { /* terminate below */ }
    this.#abortPending()
    this.#transport.removeEventListener('message', this.#listener)
    this.#transport.close?.()
    this.#transport.terminate?.()
    this.#decodeQueueSize = 0
    this.#decodeRequests.clear()
  }

  #control(
    request: DecoderWorkerRequest,
    expected: 'configured' | 'flushed' | 'reset',
  ): Promise<void> {
    if (this.#pending.size >= 8) {
      return Promise.reject(createWebCodecsError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The Decoder Worker request limit was exceeded', false))
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(request.requestId)
        reject(createWebCodecsError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The Decoder Worker operation timed out', true))
      }, this.#operationTimeoutMs)
      this.#pending.set(request.requestId, { epoch: request.epoch, expected, timer, resolve, reject })
      try { this.#transport.postMessage(request) } catch (cause) {
        clearTimeout(timer)
        this.#pending.delete(request.requestId)
        reject(createWebCodecsError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'Decoder Worker request failed', true, cause))
      }
    })
  }

  #handleMessage(response: DecoderWorkerResponse): void {
    if (response.sessionId !== this.#sessionId) {
      if (response.type === 'frame') closeFrame(response.frame)
      return
    }
    if (response.epoch !== this.#epoch) {
      if (response.type === 'frame') closeFrame(response.frame)
      return
    }
    if (response.type === 'frame') {
      if (!this.#decodeRequests.delete(response.requestId)) {
        closeFrame(response.frame)
        return
      }
      this.#decodeQueueSize = Math.max(0, this.#decodeQueueSize - 1)
      this.#callbacks.onFrame(response.frame, response.epoch)
      return
    }
    if (response.type === 'dequeue') {
      this.#decodeQueueSize = response.decodeQueueSize
      this.#callbacks.onDequeue(response.epoch)
      return
    }
    if (response.type === 'error') {
      const pending = this.#pending.get(response.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        this.#pending.delete(response.requestId)
        pending.reject(response.error)
      } else {
        this.#decodeRequests.delete(response.requestId)
        this.#callbacks.onError(response.error, response.epoch)
      }
      return
    }
    const pending = this.#pending.get(response.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.#pending.delete(response.requestId)
    if (response.type !== pending.expected) {
      pending.reject(createWebCodecsError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The Decoder Worker returned an unexpected response', false))
    } else {
      pending.resolve()
    }
  }

  #nextIdentity(epoch: number) {
    this.#requestSequence += 1
    return { sessionId: this.#sessionId, epoch, requestId: `decoder-${this.#requestSequence}` }
  }

  #ensureEpoch(epoch: number): void {
    this.#ensureOpen()
    if (epoch !== this.#epoch) throw createWebCodecsError(ErrorCodes.WEBCODECS_ABORTED, 'The Decoder Worker epoch is inactive', true)
  }

  #ensureOpen(): void {
    if (this.#closed) throw createWebCodecsError(ErrorCodes.WEBCODECS_ABORTED, 'The Decoder Worker is closed', false)
  }

  #abortPending(): void {
    const error = createWebCodecsError(ErrorCodes.WEBCODECS_ABORTED, 'The Decoder Worker operation was aborted', true)
    for (const pending of this.#pending.values()) pending.reject(error)
    for (const pending of this.#pending.values()) clearTimeout(pending.timer)
    this.#pending.clear()
  }
}

function validTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 120_000) {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_CONFIG_INVALID, 'The Decoder Worker operation timeout is invalid', false)
  }
  return value
}

export function createBrowserDecoderWorkerTransport(): DecoderWorkerTransport {
  if (typeof Worker === 'undefined') {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'Dedicated Worker is unavailable for VideoDecoder', false)
  }
  try {
    return new Worker(new URL('./worker-entry.js', import.meta.url), { type: 'module', name: 'mx-player-max-video-decoder' })
  } catch (cause) {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The VideoDecoder Worker could not be created', false, cause)
  }
}

function createSessionId(): string {
  const cryptoValue = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
  return cryptoValue?.randomUUID?.() ?? `decoder-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function closeFrame(frame: VideoFrame): void {
  try { frame.close() } catch { /* best effort for stale transferable */ }
}

export type { EngineError }
