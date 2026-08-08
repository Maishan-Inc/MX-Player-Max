import { createMediaEngine } from '@mx-player-max/core'
import type {
  AudioClockSnapshot,
  CustomAudioStats,
  CustomVideoStats,
  DecodedVideoFrame,
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
  get customVideoStats(): CustomVideoStats | null { return this.engine.customVideoStats }
  get customAudioStats(): CustomAudioStats | null { return this.engine.customAudioStats }
  get audioClock(): AudioClockSnapshot | null { return this.engine.audioClock }

  on<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): () => void {
    return this.engine.on(event, listener)
  }

  off<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): void {
    this.engine.off(event, listener)
  }

  once<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): () => void {
    return this.engine.once(event, listener)
  }

  play(): Promise<void> { return this.engine.play() }
  pause(): void { this.engine.pause() }
  seek(time: Micros): Promise<void> { return this.engine.seek(time) }
  setPlaybackRate(rate: number): void { this.engine.setPlaybackRate(rate) }
  setVolume(volume: number): void { this.engine.setVolume(volume) }
  setMuted(muted: boolean): void { this.engine.setMuted(muted) }
  readVideoFrame(): Promise<DecodedVideoFrame | null> { return this.engine.readVideoFrame() }
  requestFullscreen(): Promise<void> { return this.engine.requestFullscreen() }
  exitFullscreen(): Promise<void> { return this.engine.exitFullscreen() }
  requestPictureInPicture(): Promise<void> { return this.engine.requestPictureInPicture() }
  exitPictureInPicture(): Promise<void> { return this.engine.exitPictureInPicture() }
  destroy(): void { this.engine.close() }
}

export * from '@mx-player-max/types'
