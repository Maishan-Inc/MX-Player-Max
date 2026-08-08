import type {
  ContainerProbeResult,
  DemuxWorkerPacketsResponse,
  DemuxWorkerRequest,
  DemuxWorkerResponse,
} from '@mx-player-max/demux'
import type { EngineError, Micros, SourceDescriptor } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createEngineError } from '../native/errors'

export interface DemuxWorkerTransport {
  postMessage(message: DemuxWorkerRequest): void
  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent<DemuxWorkerResponse> | Event) => void): void
  removeEventListener(type: 'message' | 'error', listener: (event: MessageEvent<DemuxWorkerResponse> | Event) => void): void
  terminate?(): void
  close?(): void
  start?(): void
}

export type DemuxWorkerTransportFactory = () => DemuxWorkerTransport

export interface DemuxSessionOptions {
  operationTimeoutMs: number
  transportFactory?: DemuxWorkerTransportFactory
  sessionId?: string
}

export interface DemuxSessionLike {
  start(source: SourceDescriptor, epoch: number): Promise<ContainerProbeResult>
  read(epoch: number): Promise<DemuxWorkerPacketsResponse>
  seek(epoch: number, time: Micros): Promise<void>
  advanceEpoch(epoch: number): void
  close(epoch: number): void
}

interface PendingRequest {
  epoch: number
  timer: ReturnType<typeof setTimeout>
  resolve(response: DemuxWorkerResponse): void
  reject(reason: unknown): void
}

export class DemuxWorkerSession implements DemuxSessionLike {
  readonly #operationTimeoutMs: number
  readonly #transport: DemuxWorkerTransport
  readonly #sessionId: string
  readonly #pending = new Map<string, PendingRequest>()
  readonly #messageListener: (event: MessageEvent<DemuxWorkerResponse> | Event) => void
  readonly #errorListener: (event: MessageEvent<DemuxWorkerResponse> | Event) => void
  #requestSequence = 0
  #epoch = 0
  #closed = false

  constructor(options: DemuxSessionOptions) {
    this.#operationTimeoutMs = options.operationTimeoutMs
    this.#sessionId = options.sessionId ?? createSessionId()
    this.#transport = (options.transportFactory ?? createBrowserDemuxWorkerTransport)()
    this.#messageListener = (event) => {
      if ('data' in event) this.#handleResponse(event.data)
    }
    this.#errorListener = () => this.#failAll(createEngineError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The Demux Worker failed', true))
    this.#transport.addEventListener('message', this.#messageListener)
    this.#transport.addEventListener('error', this.#errorListener)
    this.#transport.start?.()
  }

  async start(source: SourceDescriptor, epoch: number): Promise<ContainerProbeResult> {
    this.#ensureOpen()
    this.#epoch = epoch
    const response = await this.#request({ command: 'start', source, ...this.#nextIdentity(epoch) })
    if (response.type !== 'probe') throw workerProtocolError()
    return response.metadata
  }

  async read(epoch: number): Promise<DemuxWorkerPacketsResponse> {
    this.#ensureEpoch(epoch)
    const response = await this.#request({ command: 'read', ...this.#nextIdentity(epoch) })
    if (response.type !== 'packets') throw workerProtocolError()
    return response
  }

  async seek(epoch: number, time: Micros): Promise<void> {
    this.#ensureOpen()
    if (!Number.isSafeInteger(time) || time < 0) {
      throw createEngineError(ErrorCodes.CUSTOM_SEEK_FAILED, 'Seek time must be a non-negative integer microsecond value', false)
    }
    if (epoch > this.#epoch) this.advanceEpoch(epoch)
    else this.#ensureEpoch(epoch)
    const response = await this.#request({ command: 'seek', time, ...this.#nextIdentity(epoch) })
    if (response.type !== 'seeked') throw workerProtocolError()
  }

  advanceEpoch(epoch: number): void {
    this.#ensureOpen()
    if (!Number.isSafeInteger(epoch) || epoch <= this.#epoch) {
      throw createEngineError(ErrorCodes.WEBCODECS_ABORTED, 'The Demux Worker epoch did not advance', true)
    }
    this.#epoch = epoch
    const aborted = createEngineError(ErrorCodes.WEBCODECS_ABORTED, 'The Demux Worker operation was superseded', true)
    for (const [requestId, pending] of this.#pending) {
      if (pending.epoch === epoch) continue
      clearTimeout(pending.timer)
      pending.reject(aborted)
      this.#pending.delete(requestId)
    }
  }

  close(epoch: number): void {
    if (this.#closed) return
    this.#closed = true
    const request: DemuxWorkerRequest = { command: 'close', ...this.#nextIdentity(Math.max(this.#epoch + 1, epoch)) }
    try { this.#transport.postMessage(request) } catch { /* terminate below */ }
    this.#failAll(createEngineError(ErrorCodes.WEBCODECS_ABORTED, 'The Demux Worker session was closed', true))
    this.#transport.removeEventListener('message', this.#messageListener)
    this.#transport.removeEventListener('error', this.#errorListener)
    this.#transport.close?.()
    this.#transport.terminate?.()
  }

  #request(request: DemuxWorkerRequest): Promise<DemuxWorkerResponse> {
    if (this.#pending.size >= 4) {
      return Promise.reject(createEngineError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The Demux Worker request limit was exceeded', false))
    }
    return new Promise<DemuxWorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(request.requestId)
        reject(createEngineError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The Demux Worker operation timed out', true))
      }, this.#operationTimeoutMs)
      this.#pending.set(request.requestId, { epoch: request.epoch, timer, resolve, reject })
      try { this.#transport.postMessage(request) } catch (cause) {
        clearTimeout(timer)
        this.#pending.delete(request.requestId)
        reject(createEngineError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The Demux Worker request failed', true, cause))
      }
    })
  }

  #handleResponse(response: DemuxWorkerResponse): void {
    const pending = this.#pending.get(response.requestId)
    if (!pending) return
    if (response.sessionId !== this.#sessionId || response.epoch !== pending.epoch || response.epoch !== this.#epoch) return
    clearTimeout(pending.timer)
    this.#pending.delete(response.requestId)
    if (response.type === 'error') {
      pending.reject(serializedError(response.error))
      return
    }
    pending.resolve(response)
  }

  #nextIdentity(epoch: number) {
    this.#requestSequence += 1
    return { sessionId: this.#sessionId, epoch, requestId: `demux-${this.#requestSequence}` }
  }

  #ensureEpoch(epoch: number): void {
    this.#ensureOpen()
    if (epoch !== this.#epoch) throw createEngineError(ErrorCodes.WEBCODECS_ABORTED, 'The Demux Worker epoch is inactive', true)
  }

  #ensureOpen(): void {
    if (this.#closed) throw createEngineError(ErrorCodes.WEBCODECS_ABORTED, 'The Demux Worker session is closed', false)
  }

  #failAll(error: EngineError): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

export function createBrowserDemuxWorkerTransport(): DemuxWorkerTransport {
  if (typeof Worker === 'undefined') {
    throw createEngineError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'Dedicated Worker is unavailable for demuxing', false)
  }
  let worker: Worker
  try {
    worker = new Worker(new URL('./demux-worker-entry.js', import.meta.url), { type: 'module', name: 'mx-player-max-demux' })
  } catch (cause) {
    throw createEngineError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The Demux Worker could not be created', false, cause)
  }
  return {
    postMessage(message): void { worker.postMessage(message) },
    addEventListener(type, listener): void { worker.addEventListener(type, listener as EventListener) },
    removeEventListener(type, listener): void { worker.removeEventListener(type, listener as EventListener) },
    terminate(): void { worker.terminate() },
  }
}

function serializedError(error: { code: string; message: string; recoverable: boolean }): EngineError {
  return { code: error.code, message: error.message, recoverable: error.recoverable }
}

function workerProtocolError() {
  return createEngineError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The Demux Worker returned an unexpected response', false)
}

function createSessionId(): string {
  const cryptoValue = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
  return cryptoValue?.randomUUID?.() ?? `demux-${Math.round(performance.now())}-${Math.random().toString(16).slice(2)}`
}
