import { ErrorCodes } from '@mx-player-max/types'
import type {
  AudioDecoderRuntime,
  AudioDecoderRuntimeCallbacks,
  AudioDecoderRuntimeFactory,
  EncodedAudioChunkFactory,
  EncodedVideoChunkFactory,
  VideoDecoderRuntime,
  VideoDecoderRuntimeCallbacks,
  VideoDecoderRuntimeFactory,
} from './contracts'
import { createWebCodecsError } from './errors'

interface VideoDecoderConstructorLike {
  new(init: VideoDecoderInit): VideoDecoder
}

interface EncodedVideoChunkConstructorLike {
  new(init: EncodedVideoChunkInit): EncodedVideoChunk
}

interface AudioDecoderConstructorLike {
  new(init: AudioDecoderInit): AudioDecoder
}

interface EncodedAudioChunkConstructorLike {
  new(init: EncodedAudioChunkInit): EncodedAudioChunk
}

class BrowserVideoDecoderRuntime implements VideoDecoderRuntime {
  readonly #decoder: VideoDecoder

  constructor(decoder: VideoDecoder, callbacks: VideoDecoderRuntimeCallbacks) {
    this.#decoder = decoder
    this.#decoder.addEventListener('dequeue', callbacks.dequeue)
  }

  get state(): VideoDecoderRuntime['state'] { return this.#decoder.state }
  get decodeQueueSize(): number { return this.#decoder.decodeQueueSize }
  configure(config: VideoDecoderConfig): void { this.#decoder.configure(config) }
  decode(chunk: EncodedVideoChunk): void { this.#decoder.decode(chunk) }
  flush(): Promise<void> { return this.#decoder.flush() }
  reset(): void { this.#decoder.reset() }
  close(): void { this.#decoder.close() }
}

export const createBrowserVideoDecoderRuntime: VideoDecoderRuntimeFactory = (callbacks) => {
  const constructor = (globalThis as unknown as { VideoDecoder?: VideoDecoderConstructorLike }).VideoDecoder
  if (!constructor) {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_API_UNAVAILABLE, 'VideoDecoder is unavailable', false)
  }
  try {
    const decoder = new constructor({ output: callbacks.output, error: callbacks.error })
    return new BrowserVideoDecoderRuntime(decoder, callbacks)
  } catch (cause) {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_API_UNAVAILABLE, 'VideoDecoder could not be created', false, cause)
  }
}

export const browserEncodedVideoChunkFactory: EncodedVideoChunkFactory = {
  create(init: EncodedVideoChunkInit): EncodedVideoChunk {
    const constructor = (globalThis as unknown as { EncodedVideoChunk?: EncodedVideoChunkConstructorLike }).EncodedVideoChunk
    if (!constructor) {
      throw createWebCodecsError(ErrorCodes.WEBCODECS_API_UNAVAILABLE, 'EncodedVideoChunk is unavailable', false)
    }
    return new constructor(init)
  },
}

class BrowserAudioDecoderRuntime implements AudioDecoderRuntime {
  readonly #decoder: AudioDecoder

  constructor(decoder: AudioDecoder, callbacks: AudioDecoderRuntimeCallbacks) {
    this.#decoder = decoder
    this.#decoder.addEventListener('dequeue', callbacks.dequeue)
  }

  get state(): AudioDecoderRuntime['state'] { return this.#decoder.state }
  get decodeQueueSize(): number { return this.#decoder.decodeQueueSize }
  configure(config: AudioDecoderConfig): void { this.#decoder.configure(config) }
  decode(chunk: EncodedAudioChunk): void { this.#decoder.decode(chunk) }
  flush(): Promise<void> { return this.#decoder.flush() }
  reset(): void { this.#decoder.reset() }
  close(): void { this.#decoder.close() }
}

export const createBrowserAudioDecoderRuntime: AudioDecoderRuntimeFactory = (callbacks) => {
  const constructor = (globalThis as unknown as { AudioDecoder?: AudioDecoderConstructorLike }).AudioDecoder
  if (!constructor) throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_API_UNAVAILABLE, 'AudioDecoder is unavailable', false)
  try {
    return new BrowserAudioDecoderRuntime(new constructor({ output: callbacks.output, error: callbacks.error }), callbacks)
  } catch (cause) {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_API_UNAVAILABLE, 'AudioDecoder could not be created', false, cause)
  }
}

export const browserEncodedAudioChunkFactory: EncodedAudioChunkFactory = {
  create(init: EncodedAudioChunkInit): EncodedAudioChunk {
    const constructor = (globalThis as unknown as { EncodedAudioChunk?: EncodedAudioChunkConstructorLike }).EncodedAudioChunk
    if (!constructor) throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_API_UNAVAILABLE, 'EncodedAudioChunk is unavailable', false)
    return new constructor(init)
  },
}
