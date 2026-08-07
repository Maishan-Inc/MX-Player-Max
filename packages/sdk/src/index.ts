import { createMediaEngine } from '@mx-player-max/core'
import type {
  EngineEventListener,
  EngineEventName,
  MediaDescriptor,
  MediaEngine,
  Micros,
  MXPlayerOptions,
  NativeMediaFeatures,
  NativePlaybackStats,
  PlaybackSelection,
  PlaybackState,
} from '@mx-player-max/types'

export class MXPlayer {
  readonly engine: MediaEngine
  readonly ready: Promise<void>

  constructor(options: MXPlayerOptions) {
    this.engine = createMediaEngine()
    this.ready = this.engine.load(options)
  }

  get state(): PlaybackState { return this.engine.state }
  get media(): MediaDescriptor | null { return this.engine.media }
  get selection(): PlaybackSelection | null { return this.engine.selection }
  get nativeFeatures(): NativeMediaFeatures | null { return this.engine.nativeFeatures }
  get nativeStats(): NativePlaybackStats | null { return this.engine.nativeStats }

  on<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): () => void {
    return this.engine.on(event, listener)
  }

  off<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): void {
    this.engine.off(event, listener)
  }

  once<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): () => void {
    return this.engine.once(event, listener)
  }

  play() { return this.engine.play() }
  pause() { this.engine.pause() }
  seek(time: Micros) { return this.engine.seek(time) }
  setPlaybackRate(rate: number) { this.engine.setPlaybackRate(rate) }
  setVolume(volume: number) { this.engine.setVolume(volume) }
  setMuted(muted: boolean) { this.engine.setMuted(muted) }
  requestFullscreen() { return this.engine.requestFullscreen() }
  exitFullscreen() { return this.engine.exitFullscreen() }
  requestPictureInPicture() { return this.engine.requestPictureInPicture() }
  exitPictureInPicture() { return this.engine.exitPictureInPicture() }
  destroy() { this.engine.close() }
}

export * from '@mx-player-max/types'
