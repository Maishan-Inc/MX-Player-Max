import {
  WorkerDecoderAdapter,
  type DecoderWorkerTransport as SharedDecoderWorkerTransport,
  type DecoderWorkerTransportFactory as SharedDecoderWorkerTransportFactory,
} from '@mx-player-max/decoder-worker'
import { ErrorCodes } from '@mx-player-max/types'
import type { VideoDecoderAdapterCallbacks, VideoDecoderAdapterLike } from './contracts'
import { createWebCodecsError } from './errors'
import type { WebCodecsWorkerConfig } from './worker-protocol'

export type DecoderWorkerTransport = SharedDecoderWorkerTransport<WebCodecsWorkerConfig>
export type DecoderWorkerTransportFactory = SharedDecoderWorkerTransportFactory<WebCodecsWorkerConfig>

export interface WorkerVideoDecoderAdapterOptions {
  callbacks: VideoDecoderAdapterCallbacks
  transportFactory?: DecoderWorkerTransportFactory
  sessionId?: string
  operationTimeoutMs?: number
}

const errors = {
  aborted: ErrorCodes.WEBCODECS_ABORTED,
  configInvalid: ErrorCodes.WEBCODECS_CONFIG_INVALID,
  configureFailed: ErrorCodes.WEBCODECS_CONFIGURE_FAILED,
  decodeFailed: ErrorCodes.WEBCODECS_DECODE_FAILED,
  flushFailed: ErrorCodes.WEBCODECS_FLUSH_FAILED,
  resetFailed: ErrorCodes.WEBCODECS_RESET_FAILED,
  workerFailed: ErrorCodes.WEBCODECS_WORKER_FAILED,
  frameInvalid: ErrorCodes.WEBCODECS_FRAME_INVALID,
} as const

export class WorkerVideoDecoderAdapter implements VideoDecoderAdapterLike {
  readonly #adapter: WorkerDecoderAdapter<WebCodecsWorkerConfig>

  constructor(options: WorkerVideoDecoderAdapterOptions) {
    this.#adapter = new WorkerDecoderAdapter({
      callbacks: options.callbacks,
      config: {
        transportFactory: options.transportFactory ?? createBrowserDecoderWorkerTransport,
        createError: createWebCodecsError,
        errors,
      },
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.operationTimeoutMs === undefined ? {} : { operationTimeoutMs: options.operationTimeoutMs }),
    })
  }

  get decodeQueueSize(): number { return this.#adapter.decodeQueueSize }

  configure(config: VideoDecoderConfig, supported: boolean, epoch: number): Promise<void> {
    return this.#adapter.configure({ kind: 'webcodecs', config, supported }, epoch)
  }

  decode: VideoDecoderAdapterLike['decode'] = (packet, epoch) => this.#adapter.decode(packet, epoch)
  flush: VideoDecoderAdapterLike['flush'] = (epoch) => this.#adapter.flush(epoch)
  reset: VideoDecoderAdapterLike['reset'] = (epoch) => this.#adapter.reset(epoch)
  close: VideoDecoderAdapterLike['close'] = () => this.#adapter.close()
}

export function createBrowserDecoderWorkerTransport(): DecoderWorkerTransport {
  if (typeof Worker === 'undefined') throw createWebCodecsError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'Dedicated Worker is unavailable for VideoDecoder', false)
  try {
    return new Worker(new URL('./worker-entry.js', import.meta.url), { type: 'module', name: 'mx-player-max-video-decoder' })
  } catch (cause) {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_WORKER_FAILED, 'The VideoDecoder Worker could not be created', false, cause)
  }
}
