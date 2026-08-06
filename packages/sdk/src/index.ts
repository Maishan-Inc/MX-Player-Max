import { createMediaEngine, type MediaEngine } from '@mx-player-max/core'
import type { MXPlayerOptions } from '@mx-player-max/types'

export class MXPlayer {
  readonly engine: MediaEngine
  readonly ready: Promise<void>

  constructor(options: MXPlayerOptions) {
    this.engine = createMediaEngine()
    this.ready = this.engine.load(options)
  }

  play() { return this.engine.play() }
  pause() { this.engine.pause() }
  seek(time: number) { return this.engine.seek(time) }
  destroy() { this.engine.close() }
}

export * from '@mx-player-max/types'
