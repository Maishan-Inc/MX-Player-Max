import type { DemuxPacket, EngineError } from '@mx-player-max/types'
import type {
  VideoDecoderAdapterCallbacks,
  VideoDecoderAdapterLike,
} from '@mx-player-max/decoder-worker'

export type {
  VideoDecoderAdapterCallbacks,
  VideoDecoderAdapterLike,
} from '@mx-player-max/decoder-worker'

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

export type AudioDecoderRuntimeState = 'unconfigured' | 'configured' | 'closed'

export interface AudioDecoderRuntime {
  readonly state: AudioDecoderRuntimeState
  readonly decodeQueueSize: number
  configure(config: AudioDecoderConfig): void
  decode(chunk: EncodedAudioChunk): void
  flush(): Promise<void>
  reset(): void
  close(): void
}

export interface AudioDecoderRuntimeCallbacks {
  output(data: AudioData): void
  error(cause: unknown): void
  dequeue(): void
}

export type AudioDecoderRuntimeFactory = (callbacks: AudioDecoderRuntimeCallbacks) => AudioDecoderRuntime

export interface EncodedAudioChunkFactory {
  create(init: EncodedAudioChunkInit): EncodedAudioChunk
}

export interface AudioDecoderAdapterCallbacks {
  onData(data: AudioData, epoch: number): void
  onError(error: EngineError, epoch: number): void
  onDequeue(epoch: number): void
}

export interface AudioDecoderAdapterLike {
  readonly decodeQueueSize: number
  configure(config: AudioDecoderConfig, supported: boolean, epoch: number): Promise<void>
  decode(packet: DemuxPacket, epoch: number): void
  flush(epoch: number): Promise<void>
  reset(epoch: number): Promise<void>
  close(): void
}

export interface AudioDecoderAdapterOptions {
  callbacks: AudioDecoderAdapterCallbacks
  runtimeFactory?: AudioDecoderRuntimeFactory
  chunkFactory?: EncodedAudioChunkFactory
}
