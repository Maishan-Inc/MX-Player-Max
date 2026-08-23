import type { TrackInfo } from '@mx-player-max/types'

/** @deprecated Use VideoDecoderAdapter and VideoDecoderRuntime for Phase 4 frame decoding. */
export interface WebCodecsDecoderConfig {
  video?: TrackInfo
  audio?: TrackInfo
}

/** @deprecated Retained as a source-compatible placeholder; audio decoding remains out of scope. */
export interface WebCodecsDecoder {
  configure(config: WebCodecsDecoderConfig): Promise<void>
  decode(packet: Uint8Array, timestamp: number, key: boolean): void
  flush(): Promise<void>
  close(): void
}

export type {
  AudioDecoderAdapterCallbacks,
  AudioDecoderAdapterLike,
  AudioDecoderAdapterOptions,
  AudioDecoderRuntime,
  AudioDecoderRuntimeCallbacks,
  AudioDecoderRuntimeFactory,
  AudioDecoderRuntimeState,
  AvcDecoderConfigExtension,
  EncodedVideoChunkFactory,
  EncodedAudioChunkFactory,
  Phase4VideoDecoderConfig,
  VideoDecoderAdapterCallbacks,
  VideoDecoderAdapterLike,
  VideoDecoderAdapterOptions,
  VideoDecoderRuntime,
  VideoDecoderRuntimeCallbacks,
  VideoDecoderRuntimeFactory,
  VideoDecoderRuntimeState,
} from './contracts'
export { createAudioDecoderConfig } from './audio-config'
export { AudioDecoderAdapter } from './audio-decoder-adapter'
export { WEBCODECS_CODEC_SCOPE } from './codec-scope'
export { createEncodedAudioChunk } from './encoded-audio-chunk'
export { createEncodedVideoChunk } from './encoded-chunk'
export { createWebCodecsError, WebCodecsError } from './errors'
export { browserEncodedVideoChunkFactory, createBrowserVideoDecoderRuntime } from './runtime-adapter'
export { browserEncodedAudioChunkFactory, createBrowserAudioDecoderRuntime } from './runtime-adapter'
export { createVideoDecoderConfig } from './video-config'
export { VideoDecoderAdapter } from './video-decoder-adapter'
export type {
  DecoderWorkerCloseRequest,
  DecoderWorkerConfigureRequest,
  DecoderWorkerConfiguredResponse,
  DecoderWorkerDecodeRequest,
  DecoderWorkerDequeueResponse,
  DecoderWorkerErrorResponse,
  DecoderWorkerFlushRequest,
  DecoderWorkerFlushedResponse,
  DecoderWorkerFrameResponse,
  DecoderWorkerRequest,
  DecoderWorkerResetRequest,
  DecoderWorkerResetResponse,
  DecoderWorkerResponse,
  WebCodecsWorkerConfig,
} from './worker-protocol'
export type {
  DecoderAdapterFactory,
  DecoderWorkerPort,
  VideoDecoderWorkerControllerOptions,
} from './worker-controller'
export { VideoDecoderWorkerController } from './worker-controller'
export type {
  DecoderWorkerTransport,
  DecoderWorkerTransportFactory,
  WorkerVideoDecoderAdapterOptions,
} from './worker-adapter'
export { createBrowserDecoderWorkerTransport, WorkerVideoDecoderAdapter } from './worker-adapter'
