import type { DemuxPacket } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type {
  VideoDecoderAdapterLike,
  VideoDecoderAdapterOptions,
  VideoDecoderRuntime,
} from './contracts'
import { createEncodedVideoChunk } from './encoded-chunk'
import { createWebCodecsError, WebCodecsError } from './errors'
import { browserEncodedVideoChunkFactory, createBrowserVideoDecoderRuntime } from './runtime-adapter'

export class VideoDecoderAdapter implements VideoDecoderAdapterLike {
  readonly #callbacks: VideoDecoderAdapterOptions['callbacks']
  readonly #chunkFactory: NonNullable<VideoDecoderAdapterOptions['chunkFactory']>
  readonly #runtimeFactory: NonNullable<VideoDecoderAdapterOptions['runtimeFactory']>
  #runtime: VideoDecoderRuntime
  #generation = 0
  #epoch = 0
  #configured = false
  #closed = false

  constructor(options: VideoDecoderAdapterOptions) {
    this.#callbacks = options.callbacks
    this.#chunkFactory = options.chunkFactory ?? browserEncodedVideoChunkFactory
    this.#runtimeFactory = options.runtimeFactory ?? createBrowserVideoDecoderRuntime
    this.#runtime = this.#createRuntime(this.#generation)
  }

  get decodeQueueSize(): number { return this.#closed ? 0 : this.#runtime.decodeQueueSize }

  async configure(config: VideoDecoderConfig, supported: boolean, epoch: number): Promise<void> {
    this.#ensureOpen()
    validateEpoch(epoch)
    if (!supported) throw createWebCodecsError(ErrorCodes.WEBCODECS_NOT_SUPPORTED, 'The video configuration is not supported', false)
    if (!config.codec.trim() || !positiveInteger(config.codedWidth) || !positiveInteger(config.codedHeight)) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_CONFIG_INVALID, 'The VideoDecoder configuration is incomplete', false)
    }
    try {
      this.#runtime.configure(config)
      this.#epoch = epoch
      this.#configured = true
    } catch (cause) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_CONFIGURE_FAILED, 'VideoDecoder configuration failed', true, cause)
    }
  }

  decode(packet: DemuxPacket, epoch: number): void {
    this.#ensureOpen()
    if (!this.#configured || epoch !== this.#epoch) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_ABORTED, 'The decode operation belongs to an inactive epoch', true)
    }
    const chunk = createEncodedVideoChunk(packet, this.#chunkFactory)
    try {
      this.#runtime.decode(chunk)
    } catch (cause) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_DECODE_FAILED, 'VideoDecoder rejected a compressed video chunk', true, cause)
    }
  }

  async flush(epoch: number): Promise<void> {
    this.#ensureOpen()
    if (!this.#configured || epoch !== this.#epoch) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_ABORTED, 'The flush operation belongs to an inactive epoch', true)
    }
    try {
      await this.#runtime.flush()
      if (this.#closed || epoch !== this.#epoch) {
        throw createWebCodecsError(ErrorCodes.WEBCODECS_ABORTED, 'The flush operation was superseded', true)
      }
    } catch (cause) {
      if (cause instanceof WebCodecsError) throw cause
      throw createWebCodecsError(ErrorCodes.WEBCODECS_FLUSH_FAILED, 'VideoDecoder flush failed', true, cause)
    }
  }

  async reset(epoch: number): Promise<void> {
    this.#ensureOpen()
    validateEpoch(epoch)
    try {
      const previous = this.#runtime
      previous.reset()
      try { previous.close() } catch { /* reset already detached its queued work */ }
      this.#generation += 1
      this.#runtime = this.#createRuntime(this.#generation)
      this.#epoch = epoch
      this.#configured = false
    } catch (cause) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_RESET_FAILED, 'VideoDecoder reset failed', true, cause)
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#configured = false
    try { this.#runtime.close() } catch { /* best effort release */ }
  }

  #createRuntime(generation: number): VideoDecoderRuntime {
    return this.#runtimeFactory({
      output: (frame) => this.#handleOutput(frame, generation),
      error: (cause) => this.#handleError(cause, generation),
      dequeue: () => {
        if (!this.#closed && generation === this.#generation) this.#callbacks.onDequeue(this.#epoch)
      },
    })
  }

  #handleOutput(frame: VideoFrame, generation: number): void {
    if (this.#closed || generation !== this.#generation) {
      closeFrame(frame)
      return
    }
    this.#callbacks.onFrame(frame, this.#epoch)
  }

  #handleError(cause: unknown, generation: number): void {
    if (this.#closed || generation !== this.#generation) return
    this.#callbacks.onError(
      createWebCodecsError(ErrorCodes.WEBCODECS_DECODE_FAILED, 'VideoDecoder reported a decode failure', true, cause),
      this.#epoch,
    )
  }

  #ensureOpen(): void {
    if (this.#closed || this.#runtime.state === 'closed') {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_ABORTED, 'VideoDecoder is closed', false)
    }
  }
}

function validateEpoch(epoch: number): void {
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_CONFIG_INVALID, 'The decoder epoch is invalid', false)
  }
}

function positiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}

function closeFrame(frame: VideoFrame): void {
  try { frame.close() } catch { /* already invalid; never expose it */ }
}
