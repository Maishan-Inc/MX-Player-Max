import type { DemuxPacket } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type { AudioDecoderAdapterLike, AudioDecoderAdapterOptions, AudioDecoderRuntime } from './contracts'
import { createEncodedAudioChunk } from './encoded-audio-chunk'
import { createWebCodecsError, WebCodecsError } from './errors'
import { browserEncodedAudioChunkFactory, createBrowserAudioDecoderRuntime } from './runtime-adapter'

export class AudioDecoderAdapter implements AudioDecoderAdapterLike {
  readonly #callbacks: AudioDecoderAdapterOptions['callbacks']
  readonly #chunkFactory: NonNullable<AudioDecoderAdapterOptions['chunkFactory']>
  readonly #runtimeFactory: NonNullable<AudioDecoderAdapterOptions['runtimeFactory']>
  #runtime: AudioDecoderRuntime
  #generation = 0
  #epoch = 0
  #configured = false
  #closed = false

  constructor(options: AudioDecoderAdapterOptions) {
    this.#callbacks = options.callbacks
    this.#chunkFactory = options.chunkFactory ?? browserEncodedAudioChunkFactory
    this.#runtimeFactory = options.runtimeFactory ?? createBrowserAudioDecoderRuntime
    this.#runtime = this.#createRuntime(0)
  }

  get decodeQueueSize(): number { return this.#closed ? 0 : this.#runtime.decodeQueueSize }

  async configure(config: AudioDecoderConfig, supported: boolean, epoch: number): Promise<void> {
    this.#ensureOpen()
    validateEpoch(epoch)
    if (!supported) throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_NOT_SUPPORTED, 'The audio configuration is not supported', false)
    if (!config.codec.trim() || !positiveInteger(config.sampleRate) || !positiveInteger(config.numberOfChannels)) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID, 'The AudioDecoder configuration is incomplete', false)
    }
    this.#epoch = epoch
    this.#configured = false
    try {
      this.#runtime.configure(config)
      this.#configured = true
    } catch (cause) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_CONFIGURE_FAILED, 'AudioDecoder configuration failed', true, cause)
    }
  }

  decode(packet: DemuxPacket, epoch: number): void {
    this.#ensureActive(epoch, 'decode')
    const chunk = createEncodedAudioChunk(packet, this.#chunkFactory)
    try { this.#runtime.decode(chunk) } catch (cause) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_DECODE_FAILED, 'AudioDecoder rejected a compressed audio chunk', true, cause)
    }
  }

  async flush(epoch: number): Promise<void> {
    this.#ensureActive(epoch, 'flush')
    try {
      await this.#runtime.flush()
      if (this.#closed || epoch !== this.#epoch) throw aborted('The audio flush operation was superseded')
    } catch (cause) {
      if (cause instanceof WebCodecsError) throw cause
      throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_FLUSH_FAILED, 'AudioDecoder flush failed', true, cause)
    }
  }

  async reset(epoch: number): Promise<void> {
    this.#ensureOpen()
    validateEpoch(epoch)
    try {
      const previous = this.#runtime
      previous.reset()
      try { previous.close() } catch { /* reset detached queued work */ }
      this.#generation += 1
      this.#runtime = this.#createRuntime(this.#generation)
      this.#epoch = epoch
      this.#configured = false
    } catch (cause) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_RESET_FAILED, 'AudioDecoder reset failed', true, cause)
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#configured = false
    try { this.#runtime.close() } catch { /* best effort */ }
  }

  #createRuntime(generation: number): AudioDecoderRuntime {
    return this.#runtimeFactory({
      output: (data) => {
        if (this.#closed || generation !== this.#generation) safeClose(data)
        else this.#callbacks.onData(data, this.#epoch)
      },
      error: (cause) => {
        if (!this.#closed && generation === this.#generation) {
          this.#callbacks.onError(createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_DECODE_FAILED, 'AudioDecoder reported a decode failure', true, cause), this.#epoch)
        }
      },
      dequeue: () => {
        if (!this.#closed && generation === this.#generation) this.#callbacks.onDequeue(this.#epoch)
      },
    })
  }

  #ensureActive(epoch: number, operation: string): void {
    this.#ensureOpen()
    if (!this.#configured || epoch !== this.#epoch) throw aborted(`The audio ${operation} operation belongs to an inactive epoch`)
  }

  #ensureOpen(): void {
    if (this.#closed || this.#runtime.state === 'closed') throw aborted('AudioDecoder is closed')
  }
}

function validateEpoch(epoch: number): void {
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID, 'The audio decoder epoch is invalid', false)
}

function positiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}

function aborted(message: string) {
  return createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_ABORTED, message, true)
}

function safeClose(data: AudioData): void {
  try { data.close() } catch { /* invalid or already closed */ }
}
