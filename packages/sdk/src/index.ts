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
  CustomRendererKind,
  RendererStats,
  RendererState,
  VideoFilterOptions,
  VideoTransformOptions,
  ExternalSubtitleSourceDescriptor,
  SubtitleCueStyle,
  SubtitleState,
  SubtitleTrack,
  SubtitleTrackOptions,
  PlaybackSnapshot,
  PlaybackDecisionTrace,
  MediaPreviewImage,
  MediaPreviewRequest,
} from '@mx-player-max/types'

export class MXPlayer {
  readonly engine: MediaEngine
  #ready: Promise<void>

  constructor(options: MXPlayerOptions) {
    this.engine = createMediaEngine()
    this.#ready = this.engine.load(options)
  }

  get ready(): Promise<void> { return this.#ready }

  get state(): PlaybackState { return this.engine.state }
  get media(): MediaDescriptor | null { return this.engine.media }
  get selection(): PlaybackSelection | null { return this.engine.selection }
  get nativeFeatures(): NativeMediaFeatures | null { return this.engine.nativeFeatures }
  get nativeStats(): NativePlaybackStats | null { return this.engine.nativeStats }
  get customVideoStats(): CustomVideoStats | null { return this.engine.customVideoStats }
  get customAudioStats(): CustomAudioStats | null { return this.engine.customAudioStats }
  get audioClock(): AudioClockSnapshot | null { return this.engine.audioClock }
  get rendererKind(): CustomRendererKind | null { return this.engine.rendererKind }
  get rendererState(): RendererState | null { return this.engine.rendererState }
  get rendererStats(): RendererStats | null { return this.engine.rendererStats }
  get subtitleTracks(): readonly SubtitleTrack[] { return this.engine.subtitleTracks }
  get selectedSubtitleTrack(): string | null { return this.engine.selectedSubtitleTrack }
  get subtitleState(): SubtitleState { return this.engine.subtitleState }
  get subtitleStyle(): SubtitleCueStyle { return this.engine.subtitleStyle }
  get playback(): PlaybackSnapshot { return this.engine.playback }
  get decisionTrace(): PlaybackDecisionTrace | null { return this.engine.decisionTrace }

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
  load(options: MXPlayerOptions): Promise<void> {
    const ready = this.engine.load(options)
    this.#ready = ready
    return ready
  }
  setVideoFilter(filter: VideoFilterOptions): Promise<void> { return this.engine.setVideoFilter(filter) }
  setVideoTransform(transform: VideoTransformOptions): void { this.engine.setVideoTransform(transform) }
  listSubtitleTracks(): readonly SubtitleTrack[] { return this.engine.listSubtitleTracks() }
  addSubtitleTrack(source: ExternalSubtitleSourceDescriptor, options?: SubtitleTrackOptions): Promise<SubtitleTrack> { return this.engine.addSubtitleTrack(source, options) }
  selectSubtitleTrack(trackId: string | null): Promise<void> { return this.engine.selectSubtitleTrack(trackId) }
  removeSubtitleTrack(trackId: string): void { this.engine.removeSubtitleTrack(trackId) }
  closeSubtitles(): void { this.engine.closeSubtitles() }
  setSubtitleStyle(style: SubtitleCueStyle): void { this.engine.setSubtitleStyle(style) }
  resetSubtitleStyle(): void { this.engine.resetSubtitleStyle() }
  attachSubtitleOverlay(host?: HTMLElement): void { this.engine.attachSubtitleOverlay(host) }
  detachSubtitleOverlay(): void { this.engine.detachSubtitleOverlay() }
  readVideoFrame(): Promise<DecodedVideoFrame | null> { return this.engine.readVideoFrame() }
  requestPreview(request: MediaPreviewRequest): Promise<MediaPreviewImage | null> { return this.engine.requestPreview(request) }
  requestFullscreen(): Promise<void> { return this.engine.requestFullscreen() }
  exitFullscreen(): Promise<void> { return this.engine.exitFullscreen() }
  requestPictureInPicture(): Promise<void> { return this.engine.requestPictureInPicture() }
  exitPictureInPicture(): Promise<void> { return this.engine.exitPictureInPicture() }
  destroy(): void { this.engine.close() }
}

export * from '@mx-player-max/types'
