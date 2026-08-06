import type { TrackInfo } from '@mx-player-max/types'

export interface WebCodecsDecoderConfig {
  video?: TrackInfo
  audio?: TrackInfo
}

export interface WebCodecsDecoder {
  configure(config: WebCodecsDecoderConfig): Promise<void>
  decode(packet: Uint8Array, timestamp: number, key: boolean): void
  flush(): Promise<void>
  close(): void
}

