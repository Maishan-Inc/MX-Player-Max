import {
  DecoderWorkerController,
  type DecoderAdapterCallbacks,
  type DecoderWorkerPort,
} from '@mx-player-max/decoder-worker'
import { ErrorCodes } from '@mx-player-max/types'
import type { VideoDecoderAdapterCallbacks, VideoDecoderAdapterLike } from './contracts'
import { createWebCodecsError } from './errors'
import { VideoDecoderAdapter } from './video-decoder-adapter'
import type { DecoderWorkerRequest, WebCodecsWorkerConfig } from './worker-protocol'

export type { DecoderWorkerPort }
export type DecoderAdapterFactory = (callbacks: VideoDecoderAdapterCallbacks) => VideoDecoderAdapterLike

export interface VideoDecoderWorkerControllerOptions {
  createAdapter?: DecoderAdapterFactory
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

export class VideoDecoderWorkerController {
  readonly #controller: DecoderWorkerController<WebCodecsWorkerConfig>

  constructor(port: DecoderWorkerPort, options: VideoDecoderWorkerControllerOptions = {}) {
    const createAdapter = options.createAdapter ?? ((callbacks: VideoDecoderAdapterCallbacks) => new VideoDecoderAdapter({ callbacks }))
    this.#controller = new DecoderWorkerController(port, {
      createAdapter: (callbacks: DecoderAdapterCallbacks) => {
        const adapter = createAdapter(callbacks)
        return {
          get decodeQueueSize(): number { return adapter.decodeQueueSize },
          configure: (value, epoch) => adapter.configure(value.config, value.supported, epoch),
          decode: (packet, epoch) => adapter.decode(packet, epoch),
          flush: (epoch) => adapter.flush(epoch),
          reset: (epoch) => adapter.reset(epoch),
          close: () => adapter.close(),
        }
      },
      createError: createWebCodecsError,
      errors,
    })
  }

  handle(request: DecoderWorkerRequest): Promise<void> {
    return this.#controller.handle(request)
  }

  close(): void {
    this.#controller.close()
  }
}
