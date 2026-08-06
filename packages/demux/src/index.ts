import type { MediaDescriptor, SourceDescriptor } from '@mx-player-max/types'

export interface RangeLoader {
  read(start: number, endExclusive: number): Promise<Uint8Array>
  close(): void
}

export interface Demuxer {
  probe(): Promise<MediaDescriptor>
  next(): Promise<Uint8Array[]>
  seek(time: number): Promise<void>
  close(): void
}

export interface DemuxerFactory {
  canHandle(container: string): boolean
  create(source: SourceDescriptor): Demuxer
}

