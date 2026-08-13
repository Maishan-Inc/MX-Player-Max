import {
  WorkerDecoderAdapter,
  type DecoderWorkerTransport as SharedDecoderWorkerTransport,
  type DecoderWorkerTransportFactory as SharedDecoderWorkerTransportFactory,
  type VideoDecoderAdapterCallbacks,
  type VideoDecoderAdapterLike,
} from '@mx-player-max/decoder-worker'
import { createWasmError } from '@mx-player-max/decoder-wasm'
import { ErrorCodes, type CapabilitySnapshot, type TrackInfo } from '@mx-player-max/types'
import type { LibvpxVp8WorkerConfig } from './worker-controller'
import { createWasmWorkerError, wasmWorkerErrors } from './worker-errors'

export type LibvpxVp8WorkerTransport = SharedDecoderWorkerTransport<LibvpxVp8WorkerConfig>
export type LibvpxVp8WorkerTransportFactory = SharedDecoderWorkerTransportFactory<LibvpxVp8WorkerConfig>

export interface WorkerLibvpxVp8DecoderAdapterOptions {
  readonly callbacks: VideoDecoderAdapterCallbacks
  readonly baseUrl: string
  readonly track: TrackInfo
  readonly capabilities: CapabilitySnapshot
  readonly transportFactory?: LibvpxVp8WorkerTransportFactory
  readonly sessionId?: string
  readonly operationTimeoutMs?: number
}

export function createLibvpxVp8VideoDecoderConfig(track: TrackInfo): VideoDecoderConfig {
  if (track.kind !== 'video' || track.width === undefined || track.height === undefined) {
    throw createWasmError(ErrorCodes.WASM_MANIFEST_INVALID, 'The VP8 WASM decoder track is incomplete', false)
  }
  return {
    codec: 'vp8',
    codedWidth: track.width,
    codedHeight: track.height,
  }
}

export class WorkerLibvpxVp8DecoderAdapter implements VideoDecoderAdapterLike {
  readonly #adapter: WorkerDecoderAdapter<LibvpxVp8WorkerConfig>
  readonly #config: LibvpxVp8WorkerConfig

  constructor(options: WorkerLibvpxVp8DecoderAdapterOptions) {
    this.#config = {
      kind: 'libvpx-vp8',
      baseUrl: options.baseUrl,
      track: options.track,
      capabilities: options.capabilities,
    }
    this.#adapter = new WorkerDecoderAdapter({
      callbacks: options.callbacks,
      config: {
        transportFactory: options.transportFactory ?? createBrowserLibvpxVp8WorkerTransport,
        createError: createWasmWorkerError,
        errors: wasmWorkerErrors,
      },
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.operationTimeoutMs === undefined ? {} : { operationTimeoutMs: options.operationTimeoutMs }),
    })
  }

  get decodeQueueSize(): number { return this.#adapter.decodeQueueSize }

  configure(config: VideoDecoderConfig, _supported: boolean, epoch: number): Promise<void> {
    validateVideoConfig(config, this.#config.track)
    return this.#adapter.configure(this.#config, epoch)
  }

  decode: VideoDecoderAdapterLike['decode'] = (packet, epoch) => this.#adapter.decode(packet, epoch)
  flush: VideoDecoderAdapterLike['flush'] = (epoch) => this.#adapter.flush(epoch)
  reset: VideoDecoderAdapterLike['reset'] = (epoch) => this.#adapter.reset(epoch)
  close: VideoDecoderAdapterLike['close'] = () => this.#adapter.close()
}

export function createBrowserLibvpxVp8WorkerTransport(): LibvpxVp8WorkerTransport {
  if (typeof Worker === 'undefined') throw createWasmError(ErrorCodes.WASM_WORKER_FAILED, 'Dedicated Worker is unavailable for the VP8 WASM decoder', false)
  try {
    return new Worker(new URL('./worker-entry.js', import.meta.url), { type: 'module', name: 'mx-player-max-libvpx-vp8-decoder' })
  } catch {
    throw createWasmError(ErrorCodes.WASM_WORKER_FAILED, 'The VP8 WASM decoder Worker could not be created', false)
  }
}

function validateVideoConfig(config: VideoDecoderConfig, track: TrackInfo): void {
  const codec = config.codec.trim().toLowerCase()
  if ((codec !== 'vp8' && !codec.startsWith('vp08.')) || config.codedWidth !== track.width || config.codedHeight !== track.height) {
    throw createWasmError(ErrorCodes.WASM_MANIFEST_INVALID, 'The VP8 WASM decoder configuration does not match the selected track', false)
  }
}
