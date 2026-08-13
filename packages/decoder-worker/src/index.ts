import type { DemuxPacket, EngineError, Micros } from '@mx-player-max/types'

interface DecoderWorkerIdentity {
  sessionId: string
  epoch: number
  requestId: string
}

export interface DecoderWorkerConfigureRequest<Config> extends DecoderWorkerIdentity {
  command: 'configure'
  config: Config
}

export interface DecoderWorkerDecodeRequest extends DecoderWorkerIdentity {
  command: 'decode'
  packet: DemuxPacket
}

export interface DecoderWorkerFlushRequest extends DecoderWorkerIdentity { command: 'flush' }
export interface DecoderWorkerResetRequest extends DecoderWorkerIdentity { command: 'reset' }
export interface DecoderWorkerCloseRequest extends DecoderWorkerIdentity { command: 'close' }

export type DecoderWorkerRequest<Config> =
  | DecoderWorkerConfigureRequest<Config>
  | DecoderWorkerDecodeRequest
  | DecoderWorkerFlushRequest
  | DecoderWorkerResetRequest
  | DecoderWorkerCloseRequest

export interface DecoderWorkerConfiguredResponse extends DecoderWorkerIdentity { type: 'configured' }
export interface DecoderWorkerFlushedResponse extends DecoderWorkerIdentity { type: 'flushed' }
export interface DecoderWorkerResetResponse extends DecoderWorkerIdentity { type: 'reset' }
export interface DecoderWorkerClosedResponse extends DecoderWorkerIdentity { type: 'closed' }
export interface DecoderWorkerDequeueResponse extends DecoderWorkerIdentity {
  type: 'dequeue'
  decodeQueueSize: number
}
export interface DecoderWorkerFrameResponse extends DecoderWorkerIdentity {
  type: 'frame'
  frame: VideoFrame
  timestamp: Micros
  duration: Micros | null
}
export interface DecoderWorkerErrorResponse extends DecoderWorkerIdentity {
  type: 'error'
  error: EngineError
}

export type DecoderWorkerResponse =
  | DecoderWorkerConfiguredResponse
  | DecoderWorkerFlushedResponse
  | DecoderWorkerResetResponse
  | DecoderWorkerClosedResponse
  | DecoderWorkerDequeueResponse
  | DecoderWorkerFrameResponse
  | DecoderWorkerErrorResponse

export interface DecoderAdapterCallbacks {
  onFrame(frame: VideoFrame, epoch: number): void
  onError(error: EngineError, epoch: number): void
  onDequeue(epoch: number): void
}

export type VideoDecoderAdapterCallbacks = DecoderAdapterCallbacks

export interface VideoDecoderAdapterLike {
  readonly decodeQueueSize: number
  configure(config: VideoDecoderConfig, supported: boolean, epoch: number): Promise<void>
  decode(packet: DemuxPacket, epoch: number): void
  flush(epoch: number): Promise<void>
  reset(epoch: number): Promise<void>
  close(): void
}

export interface DecoderAdapterLike<Config> {
  readonly decodeQueueSize: number
  configure(config: Config, epoch: number): Promise<void>
  decode(packet: DemuxPacket, epoch: number): void
  flush(epoch: number): Promise<void>
  reset(epoch: number): Promise<void>
  close(): void
}

export interface DecoderWorkerErrors {
  readonly aborted: string
  readonly configInvalid: string
  readonly configureFailed: string
  readonly decodeFailed: string
  readonly flushFailed: string
  readonly resetFailed: string
  readonly workerFailed: string
  readonly frameInvalid: string
}

export type DecoderWorkerErrorFactory = (
  code: string,
  message: string,
  recoverable: boolean,
  cause?: unknown,
) => EngineError

export interface DecoderWorkerPort {
  postMessage(message: DecoderWorkerResponse, transfer?: Transferable[]): void
}

export type DecoderAdapterFactory<Config> = (callbacks: DecoderAdapterCallbacks) => DecoderAdapterLike<Config>

export interface DecoderWorkerControllerOptions<Config> {
  createAdapter: DecoderAdapterFactory<Config>
  createError: DecoderWorkerErrorFactory
  errors: DecoderWorkerErrors
}

interface PendingFrameIdentity {
  requestId: string
  epoch: number
}

export class DecoderWorkerController<Config> {
  readonly #port: DecoderWorkerPort
  readonly #options: DecoderWorkerControllerOptions<Config>
  readonly #pendingFrames = new Map<number, PendingFrameIdentity[]>()
  #adapter: DecoderAdapterLike<Config> | null = null
  #sessionId: string | null = null
  #epoch = 0
  #lastRequestId = 'decoder'
  #closed = false

  constructor(port: DecoderWorkerPort, options: DecoderWorkerControllerOptions<Config>) {
    this.#port = port
    this.#options = options
  }

  async handle(request: DecoderWorkerRequest<Config>): Promise<void> {
    if (!validIdentity(request)) {
      this.#postError(request, this.#error(this.#options.errors.workerFailed, 'Decoder Worker message identity is invalid', false))
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
        if (this.#isCurrent(request)) this.#postError(request, this.#toEngineError(cause, this.#options.errors.resetFailed, 'Decoder Worker reset failed'))
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
        if (this.#isCurrent(request)) this.#postError(request, this.#toEngineError(cause, this.#options.errors.flushFailed, 'Decoder Worker flush failed'))
      }
    }
  }

  close(): void {
    this.#adapter?.close()
    this.#adapter = null
    this.#pendingFrames.clear()
    this.#closed = true
    this.#sessionId = null
  }

  async #configure(request: DecoderWorkerConfigureRequest<Config>): Promise<void> {
    if (this.#sessionId !== null && request.sessionId !== this.#sessionId) this.close()
    this.#closed = false
    this.#sessionId = request.sessionId
    this.#epoch = request.epoch
    this.#lastRequestId = request.requestId
    this.#pendingFrames.clear()
    try {
      if (!this.#adapter) {
        this.#adapter = this.#options.createAdapter({
          onFrame: (frame, epoch) => this.#onFrame(frame, epoch),
          onError: (error, epoch) => this.#onAdapterError(error, epoch),
          onDequeue: (epoch) => this.#onDequeue(epoch),
        })
      }
      await this.#adapter.configure(request.config, request.epoch)
      if (!this.#isCurrent(request)) return
      this.#port.postMessage({ type: 'configured', ...identity(request) })
    } catch (cause) {
      if (this.#isCurrent(request)) this.#postError(request, this.#toEngineError(cause, this.#options.errors.configureFailed, 'Decoder Worker configuration failed'))
    }
  }

  #decode(packet: DemuxPacket, request: DecoderWorkerDecodeRequest): void {
    const pending = this.#pendingFrames.get(packet.timestamp) ?? []
    pending.push({ requestId: request.requestId, epoch: request.epoch })
    this.#pendingFrames.set(packet.timestamp, pending)
    try {
      this.#adapter?.decode(packet, request.epoch)
    } catch (cause) {
      pending.pop()
      if (pending.length === 0) this.#pendingFrames.delete(packet.timestamp)
      this.#postError(request, this.#toEngineError(cause, this.#options.errors.decodeFailed, 'Decoder Worker decode failed'))
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
      this.#postError({ sessionId: this.#sessionId, epoch, requestId: this.#lastRequestId }, this.#error(this.#options.errors.frameInvalid, 'Decoder Worker produced an invalid frame', false))
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
      type: 'frame', sessionId: this.#sessionId, epoch, requestId: match.requestId,
      frame, timestamp, duration,
    }, [frame])
  }

  #onDequeue(epoch: number): void {
    if (this.#closed || this.#sessionId === null || epoch !== this.#epoch) return
    this.#port.postMessage({
      type: 'dequeue', sessionId: this.#sessionId, epoch, requestId: this.#lastRequestId,
      decodeQueueSize: this.#adapter?.decodeQueueSize ?? 0,
    })
  }

  #onAdapterError(error: EngineError, epoch: number): void {
    if (this.#closed || this.#sessionId === null || epoch !== this.#epoch) return
    this.#postError({ sessionId: this.#sessionId, epoch, requestId: this.#lastRequestId }, error)
  }

  #close(request: DecoderWorkerCloseRequest): void {
    if (request.sessionId === this.#sessionId) this.close()
    this.#port.postMessage({ type: 'closed', ...identity(request) })
  }

  #postError(request: DecoderWorkerIdentity, error: EngineError): void {
    this.#port.postMessage({ type: 'error', ...identity(request), error: sanitizeError(error) })
  }

  #isCurrent(request: { sessionId: string; epoch: number }): boolean {
    return !this.#closed && request.sessionId === this.#sessionId && request.epoch === this.#epoch
  }

  #error(code: string, message: string, recoverable: boolean, cause?: unknown): EngineError {
    return this.#options.createError(code, message, recoverable, cause)
  }

  #toEngineError(cause: unknown, code: string, message: string): EngineError {
    if (isEngineError(cause)) return cause
    return this.#error(code, message, true, cause)
  }
}

export interface DecoderWorkerTransport<Config> {
  postMessage(message: DecoderWorkerRequest<Config>, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<DecoderWorkerResponse>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<DecoderWorkerResponse>) => void): void
  terminate?(): void
  close?(): void
  start?(): void
}

export type DecoderWorkerTransportFactory<Config> = () => DecoderWorkerTransport<Config>

export interface WorkerDecoderAdapterOptions<Config> {
  callbacks: DecoderAdapterCallbacks
  config: {
    transportFactory: DecoderWorkerTransportFactory<Config>
    createError: DecoderWorkerErrorFactory
    errors: DecoderWorkerErrors
  }
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

export class WorkerDecoderAdapter<Config> implements DecoderAdapterLike<Config> {
  readonly #callbacks: DecoderAdapterCallbacks
  readonly #transport: DecoderWorkerTransport<Config>
  readonly #createError: DecoderWorkerErrorFactory
  readonly #errors: DecoderWorkerErrors
  readonly #sessionId: string
  readonly #operationTimeoutMs: number
  readonly #pending = new Map<string, PendingOperation>()
  readonly #decodeRequests = new Set<string>()
  readonly #listener: (event: MessageEvent<DecoderWorkerResponse>) => void
  #requestSequence = 0
  #epoch = 0
  #decodeQueueSize = 0
  #closed = false

  constructor(options: WorkerDecoderAdapterOptions<Config>) {
    this.#callbacks = options.callbacks
    this.#createError = options.config.createError
    this.#errors = options.config.errors
    this.#sessionId = options.sessionId ?? createSessionId()
    this.#operationTimeoutMs = validTimeout(options.operationTimeoutMs ?? 10_000, this.#createError, this.#errors.configInvalid)
    this.#transport = options.config.transportFactory()
    this.#listener = (event) => this.#handleMessage(event.data)
    this.#transport.addEventListener('message', this.#listener)
    this.#transport.start?.()
  }

  get decodeQueueSize(): number { return this.#decodeQueueSize }

  configure(config: Config, epoch: number): Promise<void> {
    this.#ensureOpen()
    this.#epoch = epoch
    return this.#control({ command: 'configure', config, ...this.#nextIdentity(epoch) }, 'configured')
  }

  decode(packet: DemuxPacket, epoch: number): void {
    this.#ensureEpoch(epoch)
    const request: DecoderWorkerRequest<Config> = { command: 'decode', packet, ...this.#nextIdentity(epoch) }
    this.#transport.postMessage(request, [packet.data.buffer])
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
    const request: DecoderWorkerRequest<Config> = { command: 'close', ...this.#nextIdentity(this.#epoch + 1) }
    try { this.#transport.postMessage(request) } catch { /* terminate below */ }
    this.#abortPending()
    this.#transport.removeEventListener('message', this.#listener)
    this.#transport.close?.()
    this.#transport.terminate?.()
    this.#decodeQueueSize = 0
    this.#decodeRequests.clear()
  }

  #control(request: DecoderWorkerRequest<Config>, expected: PendingOperation['expected']): Promise<void> {
    if (this.#pending.size >= 8) return Promise.reject(this.#error(this.#errors.workerFailed, 'The Decoder Worker request limit was exceeded', false))
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(request.requestId)
        reject(this.#error(this.#errors.workerFailed, 'The Decoder Worker operation timed out', true))
      }, this.#operationTimeoutMs)
      this.#pending.set(request.requestId, { epoch: request.epoch, expected, timer, resolve, reject })
      try { this.#transport.postMessage(request) } catch (cause) {
        clearTimeout(timer)
        this.#pending.delete(request.requestId)
        reject(this.#error(this.#errors.workerFailed, 'Decoder Worker request failed', true, cause))
      }
    })
  }

  #handleMessage(response: DecoderWorkerResponse): void {
    if (response.sessionId !== this.#sessionId || response.epoch !== this.#epoch) {
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
    if (response.type !== pending.expected) pending.reject(this.#error(this.#errors.workerFailed, 'The Decoder Worker returned an unexpected response', false))
    else pending.resolve()
  }

  #nextIdentity(epoch: number): DecoderWorkerIdentity {
    this.#requestSequence += 1
    return { sessionId: this.#sessionId, epoch, requestId: `decoder-${this.#requestSequence}` }
  }

  #ensureEpoch(epoch: number): void {
    this.#ensureOpen()
    if (epoch !== this.#epoch) throw this.#error(this.#errors.aborted, 'The Decoder Worker epoch is inactive', true)
  }

  #ensureOpen(): void {
    if (this.#closed) throw this.#error(this.#errors.aborted, 'The Decoder Worker is closed', false)
  }

  #abortPending(): void {
    const error = this.#error(this.#errors.aborted, 'The Decoder Worker operation was aborted', true)
    for (const pending of this.#pending.values()) pending.reject(error)
    for (const pending of this.#pending.values()) clearTimeout(pending.timer)
    this.#pending.clear()
  }

  #error(code: string, message: string, recoverable: boolean, cause?: unknown): EngineError {
    return this.#createError(code, message, recoverable, cause)
  }
}

function identity(value: DecoderWorkerIdentity): DecoderWorkerIdentity {
  return { sessionId: value.sessionId, epoch: value.epoch, requestId: value.requestId }
}

function validIdentity(value: DecoderWorkerIdentity): boolean {
  return value.sessionId.length > 0 && value.requestId.length > 0 && Number.isSafeInteger(value.epoch) && value.epoch >= 0
}

function sanitizeError(error: EngineError): EngineError {
  return { code: error.code, message: error.message, recoverable: error.recoverable }
}

function isEngineError(cause: unknown): cause is EngineError {
  return typeof cause === 'object' && cause !== null
    && 'code' in cause && typeof cause.code === 'string'
    && 'message' in cause && typeof cause.message === 'string'
    && 'recoverable' in cause && typeof cause.recoverable === 'boolean'
}

function safeMicros(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function validTimeout(value: number, createError: DecoderWorkerErrorFactory, code: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 120_000) throw createError(code, 'The Decoder Worker operation timeout is invalid', false)
  return value
}

function createSessionId(): string {
  const cryptoValue = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
  return cryptoValue?.randomUUID?.() ?? `decoder-${Math.round(performance.now())}-${Math.random().toString(16).slice(2)}`
}

function closeFrame(frame: VideoFrame): void {
  try { frame.close() } catch { /* best effort for stale transferable */ }
}
