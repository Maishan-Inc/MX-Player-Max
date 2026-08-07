import type { DemuxPacket, EngineError, Micros } from '@mx-player-max/types'

interface DecoderWorkerIdentity {
  sessionId: string
  epoch: number
  requestId: string
}

export interface DecoderWorkerConfigureRequest extends DecoderWorkerIdentity {
  command: 'configure'
  config: VideoDecoderConfig
  supported: boolean
}

export interface DecoderWorkerDecodeRequest extends DecoderWorkerIdentity {
  command: 'decode'
  packet: DemuxPacket
}

export interface DecoderWorkerFlushRequest extends DecoderWorkerIdentity { command: 'flush' }
export interface DecoderWorkerResetRequest extends DecoderWorkerIdentity { command: 'reset' }
export interface DecoderWorkerCloseRequest extends DecoderWorkerIdentity { command: 'close' }

export type DecoderWorkerRequest =
  | DecoderWorkerConfigureRequest
  | DecoderWorkerDecodeRequest
  | DecoderWorkerFlushRequest
  | DecoderWorkerResetRequest
  | DecoderWorkerCloseRequest

export interface DecoderWorkerConfiguredResponse extends DecoderWorkerIdentity { type: 'configured' }
export interface DecoderWorkerFlushedResponse extends DecoderWorkerIdentity { type: 'flushed' }
export interface DecoderWorkerResetResponse extends DecoderWorkerIdentity { type: 'reset' }
export interface DecoderWorkerClosedResponse extends DecoderWorkerIdentity { type: 'closed' }
export interface DecoderWorkerDequeueResponse extends DecoderWorkerIdentity {
  type: 'dequeue'
  decodeQueueSize: number
}
export interface DecoderWorkerFrameResponse extends DecoderWorkerIdentity {
  type: 'frame'
  frame: VideoFrame
  timestamp: Micros
  duration: Micros | null
}
export interface DecoderWorkerErrorResponse extends DecoderWorkerIdentity {
  type: 'error'
  error: EngineError
}

export type DecoderWorkerResponse =
  | DecoderWorkerConfiguredResponse
  | DecoderWorkerFlushedResponse
  | DecoderWorkerResetResponse
  | DecoderWorkerClosedResponse
  | DecoderWorkerDequeueResponse
  | DecoderWorkerFrameResponse
  | DecoderWorkerErrorResponse
