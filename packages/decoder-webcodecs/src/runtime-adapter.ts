import { ErrorCodes } from '@mx-player-max/types'
import type {
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
