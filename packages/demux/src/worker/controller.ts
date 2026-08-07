import { ErrorCodes, type SourceDescriptor } from '@mx-player-max/types'
import { probeContainer, type ContainerSelection } from '../containers/registry'
import { resolveDemuxLimits, type DemuxLimits, type DemuxLimitsInput } from '../containers/limits'
import { createRangeLoader } from '../range/factory'
import { DemuxError, isDemuxError } from '../range/errors'
import type { CreateRangeLoaderOptions, RangeLoader, RangeLoaderFactory } from '../range/types'
import type {
  DemuxWorkerCloseRequest,
  DemuxWorkerReadRequest,
  DemuxWorkerRequest,
  DemuxWorkerResponse,
  DemuxWorkerSeekRequest,
  DemuxWorkerStartRequest,
  SerializedDemuxError,
} from './protocol'

export interface DemuxWorkerPort {
  postMessage(message: DemuxWorkerResponse, transfer?: Transferable[]): void
}

export type ContainerProbeFunction = (
  reader: RangeLoader,
  options?: { limits?: DemuxLimitsInput },
) => Promise<ContainerSelection>

export interface DemuxWorkerControllerOptions {
  createLoader?: RangeLoaderFactory
  loaderOptions?: CreateRangeLoaderOptions
  probe?: ContainerProbeFunction
}

interface WorkerSession {
  sessionId: string
  epoch: number
  closed: boolean
  loader: RangeLoader
  limits: DemuxLimits
  ready: Promise<ContainerSelection>
  selection: ContainerSelection | null
  chain: Promise<void>
}

function serializeError(value: unknown): SerializedDemuxError {
  if (isDemuxError(value)) {
    return {
      code: value.code,
      message: value.message,
      recoverable: value.recoverable,
      context: value.context,
    }
  }
  return {
    code: ErrorCodes.CONTAINER_INVALID,
    message: 'Demux worker operation failed',
    recoverable: false,
    context: {},
  }
}

function defaultLoaderFactory(options: CreateRangeLoaderOptions | undefined): RangeLoaderFactory {
  return (source: SourceDescriptor) => createRangeLoader(source, options)
}

export class DemuxWorkerController {
  readonly #port: DemuxWorkerPort
  readonly #createLoader: RangeLoaderFactory
  readonly #probe: ContainerProbeFunction
  #session: WorkerSession | null = null

  constructor(port: DemuxWorkerPort, options: DemuxWorkerControllerOptions = {}) {
    this.#port = port
    this.#createLoader = options.createLoader ?? defaultLoaderFactory(options.loaderOptions)
    this.#probe = options.probe ?? probeContainer
  }

  async handle(request: DemuxWorkerRequest): Promise<void> {
    if (!this.#validIdentity(request.sessionId, request.epoch, request.requestId)) {
      this.#postError(request, new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Worker message identity is invalid'))
      return
    }
    if (request.command === 'start') {
      await this.#start(request)
      return
    }
    if (request.command === 'close') {
      this.#close(request)
      return
    }
    const session = this.#session
    if (session === null || session.sessionId !== request.sessionId || session.closed) return
    if (request.command === 'seek') {
      if (request.epoch <= session.epoch) {
        this.#postError(request, new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Seek epoch must increase'))
        return
      }
      session.epoch = request.epoch
      await this.#enqueue(session, request, () => this.#seek(session, request))
      return
    }
    if (request.epoch !== session.epoch) return
    await this.#enqueue(session, request, () => this.#read(session, request))
  }

  close(): void {
    this.#disposeSession()
  }

  async #start(request: DemuxWorkerStartRequest): Promise<void> {
    this.#disposeSession()
    let loader: RangeLoader
    let limits: DemuxLimits
    try {
      limits = resolveDemuxLimits(request.limits)
      loader = this.#createLoader(request.source)
    } catch (cause) {
      this.#postError(request, cause)
      return
    }
    const ready = this.#probe(loader, { limits })
    const session: WorkerSession = {
      sessionId: request.sessionId,
      epoch: request.epoch,
      closed: false,
      loader,
      limits,
      ready,
      selection: null,
      chain: Promise.resolve(),
    }
    this.#session = session
    try {
      const selection = await ready
      if (!this.#isCurrent(session, request)) {
        selection.demuxer.close()
        return
      }
      session.selection = selection
      this.#port.postMessage({
        type: 'probe',
        sessionId: request.sessionId,
        epoch: request.epoch,
        requestId: request.requestId,
        metadata: selection.metadata,
      })
    } catch (cause) {
      if (!this.#isCurrent(session, request)) return
      this.#postError(request, cause)
      this.#disposeSession()
    }
  }

  #close(request: DemuxWorkerCloseRequest): void {
    const session = this.#session
    if (session !== null && session.sessionId === request.sessionId) {
      session.epoch = Math.max(session.epoch, request.epoch)
      this.#disposeSession()
    }
    this.#port.postMessage({
      type: 'closed',
      sessionId: request.sessionId,
      epoch: request.epoch,
      requestId: request.requestId,
    })
  }

  async #read(session: WorkerSession, request: DemuxWorkerReadRequest): Promise<void> {
    const selection = await session.ready
    if (!this.#isCurrent(session, request)) return
    const packets = await selection.demuxer.next()
    if (!this.#isCurrent(session, request)) return
    const bytes = packets.reduce((sum, packet) => sum + packet.data.byteLength, 0)
    if (!Number.isSafeInteger(bytes) || bytes > session.limits.maxWorkerMessageBytes) {
      throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'Packet response exceeds the Worker message budget')
    }
    const transfer: Transferable[] = []
    const buffers = new Set<ArrayBuffer>()
    for (const packet of packets) {
      if (packet.data.buffer instanceof ArrayBuffer && !buffers.has(packet.data.buffer)) {
        buffers.add(packet.data.buffer)
        transfer.push(packet.data.buffer)
      }
    }
    this.#port.postMessage({
      type: 'packets',
      sessionId: request.sessionId,
      epoch: request.epoch,
      requestId: request.requestId,
      packets,
      endOfStream: packets.length === 0,
    }, transfer)
  }

  async #seek(session: WorkerSession, request: DemuxWorkerSeekRequest): Promise<void> {
    const selection = await session.ready
    if (!this.#isCurrent(session, request)) return
    await selection.demuxer.seek(request.time)
    if (!this.#isCurrent(session, request)) return
    this.#port.postMessage({
      type: 'seeked',
      sessionId: request.sessionId,
      epoch: request.epoch,
      requestId: request.requestId,
      time: request.time,
    })
  }

  async #enqueue(
    session: WorkerSession,
    request: DemuxWorkerReadRequest | DemuxWorkerSeekRequest,
    operation: () => Promise<void>,
  ): Promise<void> {
    const scheduled = session.chain.then(async () => {
      if (!this.#isCurrent(session, request)) return
      try {
        await operation()
      } catch (cause) {
        if (this.#isCurrent(session, request)) this.#postError(request, cause)
      }
    })
    session.chain = scheduled.then(() => undefined, () => undefined)
    await scheduled
  }

  #disposeSession(): void {
    const session = this.#session
    if (session === null) return
    session.closed = true
    session.selection?.demuxer.close()
    session.loader.close()
    this.#session = null
  }

  #isCurrent(
    session: WorkerSession,
    request: { sessionId: string; epoch: number },
  ): boolean {
    return this.#session === session
      && !session.closed
      && session.sessionId === request.sessionId
      && session.epoch === request.epoch
  }

  #postError(
    request: { sessionId: string; epoch: number; requestId: string },
    cause: unknown,
  ): void {
    this.#port.postMessage({
      type: 'error',
      sessionId: request.sessionId,
      epoch: request.epoch,
      requestId: request.requestId,
      error: serializeError(cause),
    })
  }

  #validIdentity(sessionId: string, epoch: number, requestId: string): boolean {
    return sessionId.length > 0
      && requestId.length > 0
      && Number.isSafeInteger(epoch)
      && epoch >= 0
  }
}

