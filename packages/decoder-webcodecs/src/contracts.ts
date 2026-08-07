import type { DemuxPacket, EngineError } from '@mx-player-max/types'

export type VideoDecoderRuntimeState = 'unconfigured' | 'configured' | 'closed'

export interface VideoDecoderRuntime {
  readonly state: VideoDecoderRuntimeState
  readonly decodeQueueSize: number

  configure(config: VideoDecoderConfig): void
  decode(chunk: EncodedVideoChunk): void
  flush(): Promise<void>
  reset(): void
  close(): void
}

export interface VideoDecoderRuntimeCallbacks {
  output(frame: VideoFrame): void
  error(cause: unknown): void
  dequeue(): void
}

export type VideoDecoderRuntimeFactory = (callbacks: VideoDecoderRuntimeCallbacks) => VideoDecoderRuntime

export interface EncodedVideoChunkFactory {
  create(init: EncodedVideoChunkInit): EncodedVideoChunk
}

export interface VideoDecoderAdapterCallbacks {
  onFrame(frame: VideoFrame, epoch: number): void
  onError(error: EngineError, epoch: number): void
  onDequeue(epoch: number): void
}

export interface VideoDecoderAdapterLike {
  readonly decodeQueueSize: number

  configure(config: VideoDecoderConfig, supported: boolean, epoch: number): Promise<void>
  decode(packet: DemuxPacket, epoch: number): void
  flush(epoch: number): Promise<void>
  reset(epoch: number): Promise<void>
  close(): void
}

export interface VideoDecoderAdapterOptions {
  callbacks: VideoDecoderAdapterCallbacks
  runtimeFactory?: VideoDecoderRuntimeFactory
  chunkFactory?: EncodedVideoChunkFactory
}

/** WebCodecs AVC registration extension missing from some TypeScript DOM releases. */
export interface AvcDecoderConfigExtension {
  avc?: { format: 'avc' | 'annexb' }
}

export type Phase4VideoDecoderConfig = VideoDecoderConfig & AvcDecoderConfigExtension
