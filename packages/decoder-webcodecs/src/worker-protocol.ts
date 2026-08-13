import type {
  DecoderWorkerCloseRequest as SharedDecoderWorkerCloseRequest,
  DecoderWorkerConfigureRequest as SharedDecoderWorkerConfigureRequest,
  DecoderWorkerDecodeRequest as SharedDecoderWorkerDecodeRequest,
  DecoderWorkerFlushRequest as SharedDecoderWorkerFlushRequest,
  DecoderWorkerRequest as SharedDecoderWorkerRequest,
  DecoderWorkerResetRequest as SharedDecoderWorkerResetRequest,
} from '@mx-player-max/decoder-worker'

export interface WebCodecsWorkerConfig {
  kind: 'webcodecs'
  config: VideoDecoderConfig
  supported: boolean
}

export type DecoderWorkerConfigureRequest = SharedDecoderWorkerConfigureRequest<WebCodecsWorkerConfig>
export type DecoderWorkerDecodeRequest = SharedDecoderWorkerDecodeRequest
export type DecoderWorkerFlushRequest = SharedDecoderWorkerFlushRequest
export type DecoderWorkerResetRequest = SharedDecoderWorkerResetRequest
export type DecoderWorkerCloseRequest = SharedDecoderWorkerCloseRequest
export type DecoderWorkerRequest = SharedDecoderWorkerRequest<WebCodecsWorkerConfig>

export type {
  DecoderWorkerClosedResponse,
  DecoderWorkerConfiguredResponse,
  DecoderWorkerDequeueResponse,
  DecoderWorkerErrorResponse,
  DecoderWorkerFlushedResponse,
  DecoderWorkerFrameResponse,
  DecoderWorkerResetResponse,
  DecoderWorkerResponse,
} from '@mx-player-max/decoder-worker'
