import type { MXPlayerOptions, PlaybackSelection } from '@mx-player-max/types'

export interface MediaEngine {
  readonly selection: PlaybackSelection | null
  load(options: MXPlayerOptions): Promise<void>
  play(): Promise<void>
  pause(): void
  seek(time: number): Promise<void>
  close(): void
}

export function createMediaEngine(): MediaEngine {
  let selection: PlaybackSelection | null = null
  return {
    get selection() { return selection },
    async load(_options) { throw new Error('MEDIA_ENGINE_NOT_IMPLEMENTED') },
    async play() { throw new Error('MEDIA_ENGINE_NOT_IMPLEMENTED') },
    pause() {},
    async seek(_time) { throw new Error('MEDIA_ENGINE_NOT_IMPLEMENTED') },
    close() { selection = null },
  }
}

