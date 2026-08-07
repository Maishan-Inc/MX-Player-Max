import type { DemuxPacket, MediaDescriptor, Micros, TrackInfo } from '@mx-player-max/types'
import type { RangeLoader } from '../range/types'

export interface ContainerProbeResult {
  container: string
  media: MediaDescriptor
  tracks: TrackInfo[]
  duration: Micros | null
  size: number | null
  hasSeekIndex: boolean
}

export interface Demuxer {
  probe(): Promise<MediaDescriptor>
  next(): Promise<DemuxPacket[]>
  seek(time: Micros): Promise<void>
  close(): void
}

export interface ContainerAdapter {
  readonly id: string
  readonly name: string
  canProbe(header: Uint8Array): boolean
  probe(reader: RangeLoader): Promise<ContainerProbeResult>
  createDemuxer(reader: RangeLoader, metadata: ContainerProbeResult): Demuxer
}

