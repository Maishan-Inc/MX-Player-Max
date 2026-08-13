import {
  DecoderWorkerController,
  type DecoderAdapterCallbacks,
  type DecoderAdapterLike,
  type DecoderWorkerPort,
  type DecoderWorkerRequest,
} from '@mx-player-max/decoder-worker'
import {
  createMemoryWasmCache,
  createWasmDecoderManager,
  createWasmDecoderRegistry,
  type WasmDecoderInstance,
  type WasmDecoderManager,
} from '@mx-player-max/decoder-wasm'
import type { CapabilitySnapshot, DemuxPacket, TrackInfo } from '@mx-player-max/types'
import { createLibvpxVp8Plugin } from './plugin'
import { createWasmWorkerError, wasmWorkerErrors } from './worker-errors'

export interface LibvpxVp8WorkerConfig {
  readonly kind: 'libvpx-vp8'
  readonly baseUrl: string
  readonly track: TrackInfo
  readonly capabilities: CapabilitySnapshot
}

export interface LibvpxVp8WorkerBackendOptions {
  readonly fetcher?: typeof fetch
}

export class LibvpxVp8WorkerBackend implements DecoderAdapterLike<LibvpxVp8WorkerConfig> {
  readonly #callbacks: DecoderAdapterCallbacks
  readonly #options: LibvpxVp8WorkerBackendOptions
  #manager: WasmDecoderManager | null = null
  #instance: WasmDecoderInstance | null = null
  #epoch = 0
  #closed = false

  constructor(callbacks: DecoderAdapterCallbacks, options: LibvpxVp8WorkerBackendOptions = {}) {
    this.#callbacks = callbacks
    this.#options = options
  }

  get decodeQueueSize(): number { return this.#instance?.decodeQueueSize ?? 0 }

  async configure(config: LibvpxVp8WorkerConfig, epoch: number): Promise<void> {
    this.#ensureOpen()
    this.#epoch = epoch
    if (this.#instance) return
    const plugin = createLibvpxVp8Plugin()
    const manager = createWasmDecoderManager({
      baseUrl: config.baseUrl,
      registry: createWasmDecoderRegistry([plugin]),
      cache: createMemoryWasmCache(),
      requireApprovedReview: false,
      ...(this.#options.fetcher === undefined ? {} : { fetcher: this.#options.fetcher }),
    })
    this.#manager = manager
    try {
      this.#instance = await manager.load('vp8', config.track, config.capabilities, {
        callbacks: {
          onFrame: (frame) => this.#callbacks.onFrame(frame, this.#epoch),
          onError: (error) => this.#callbacks.onError(error, this.#epoch),
          onDequeue: () => this.#callbacks.onDequeue(this.#epoch),
        },
      })
    } catch (cause) {
      manager.close()
      if (this.#manager === manager) this.#manager = null
      throw cause
    }
  }

  decode(packet: DemuxPacket, epoch: number): void {
    this.#ensureEpoch(epoch)
    this.#instance?.decode(packet)
  }

  async flush(epoch: number): Promise<void> {
    this.#ensureEpoch(epoch)
    await this.#instance?.flush()
  }

  async reset(epoch: number): Promise<void> {
    this.#ensureOpen()
    this.#epoch = epoch
    await this.#instance?.reset()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#instance?.close()
    this.#instance = null
    this.#manager?.close()
    this.#manager = null
  }

  #ensureEpoch(epoch: number): void {
    this.#ensureOpen()
    if (epoch !== this.#epoch || !this.#instance) throw createWasmWorkerError(wasmWorkerErrors.aborted, 'The VP8 WASM decoder Worker epoch is inactive', true)
  }

  #ensureOpen(): void {
    if (this.#closed) throw createWasmWorkerError(wasmWorkerErrors.aborted, 'The VP8 WASM decoder Worker is closed', false)
  }
}

export interface LibvpxVp8WorkerControllerOptions extends LibvpxVp8WorkerBackendOptions {
  readonly createBackend?: (callbacks: DecoderAdapterCallbacks) => DecoderAdapterLike<LibvpxVp8WorkerConfig>
}

export class LibvpxVp8WorkerController {
  readonly #controller: DecoderWorkerController<LibvpxVp8WorkerConfig>

  constructor(port: DecoderWorkerPort, options: LibvpxVp8WorkerControllerOptions = {}) {
    this.#controller = new DecoderWorkerController(port, {
      createAdapter: options.createBackend ?? ((callbacks) => new LibvpxVp8WorkerBackend(callbacks, options)),
      createError: createWasmWorkerError,
      errors: wasmWorkerErrors,
    })
  }

  handle(request: DecoderWorkerRequest<LibvpxVp8WorkerConfig>): Promise<void> { return this.#controller.handle(request) }
  close(): void { this.#controller.close() }
}

export type { DecoderWorkerPort }
