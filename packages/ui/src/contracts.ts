import type { MXPlayer } from '@mx-player-max/sdk'

export interface TheaterModeAdapter {
  getState(): boolean
  setState(active: boolean): void | Promise<void>
  subscribe(listener: (active: boolean) => void): () => void
}

export interface PlayerUiFeatureOptions {
  readonly nextEpisode?: boolean
  readonly volume?: boolean
  readonly subtitles?: boolean
  readonly pictureInPicture?: boolean
  readonly theater?: boolean
  readonly settings?: boolean
  readonly statistics?: boolean
  readonly about?: boolean
  readonly fullscreen?: boolean
  readonly preview?: boolean
}

export interface NextEpisodeControlOptions {
  readonly onRequest?: () => void | Promise<void>
  readonly unavailableBehavior?: 'disabled' | 'hidden'
}

export interface PlayerUiLabels {
  readonly play: string
  readonly pause: string
  readonly replay: string
  readonly nextEpisode: string
  readonly mute: string
  readonly unmute: string
  readonly volume: string
  readonly seek: string
  readonly subtitles: string
  readonly pictureInPicture: string
  readonly exitPictureInPicture: string
  readonly theater: string
  readonly exitTheater: string
  readonly settings: string
  readonly statistics: string
  readonly about: string
  readonly fullscreen: string
  readonly exitFullscreen: string
  readonly close: string
  readonly subtitleOff: string
  readonly subtitleTracks: string
  readonly subtitleStyle: string
  readonly fontFamily: string
  readonly fontSize: string
  readonly alignment: string
  readonly horizontalPosition: string
  readonly subtitlePosition: string
  readonly subtitleColor: string
  readonly outlineColor: string
  readonly outlineWidth: string
  readonly bold: string
  readonly italic: string
  readonly underline: string
  readonly embeddedTrack: string
  readonly localTrack: string
  readonly remoteTrack: string
  readonly reset: string
  readonly playbackRate: string
  readonly noSubtitles: string
  readonly loading: string
  readonly buffering: string
  readonly seeking: string
  readonly error: string
  readonly unknownDuration: string
}

export interface PlayerUiErrorSummary {
  readonly code: PlayerUiErrorCode
  readonly recoverable: boolean
}

export interface PlayerUiOptions {
  readonly theme?: 'dark' | 'light' | 'system'
  readonly features?: PlayerUiFeatureOptions
  readonly labels?: Readonly<Partial<PlayerUiLabels>>
  readonly autoHideDelayMs?: number
  readonly nextEpisode?: NextEpisodeControlOptions
  readonly theaterMode?: TheaterModeAdapter
  readonly onError?: (error: PlayerUiErrorSummary) => void
}

export interface PlayerUiController {
  readonly attached: boolean
  attach(container: HTMLElement): void
  update(options: PlayerUiOptions): void
  destroy(): void
}

export type PlayerUiPlayer = Pick<MXPlayer, 'playback' | 'state' | 'play' | 'pause' | 'seek' | 'setVolume' | 'setMuted' | 'setPlaybackRate' | 'requestFullscreen' | 'exitFullscreen' | 'requestPictureInPicture' | 'exitPictureInPicture' | 'subtitleTracks' | 'selectedSubtitleTrack' | 'subtitleState' | 'subtitleStyle' | 'setSubtitleStyle' | 'resetSubtitleStyle' | 'selectSubtitleTrack' | 'on' | 'off' | 'requestPreview'>

export const DEFAULT_LABELS: PlayerUiLabels = {
  play: 'Play', pause: 'Pause', replay: 'Replay', nextEpisode: 'Next episode', mute: 'Mute', unmute: 'Unmute', volume: 'Volume',
  seek: 'Seek', subtitles: 'Subtitles', pictureInPicture: 'Picture in picture', exitPictureInPicture: 'Exit picture in picture', theater: 'Theater mode', exitTheater: 'Exit theater mode', settings: 'Settings', statistics: 'Statistics', about: 'About',
  fullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen', close: 'Close', subtitleOff: 'Off', subtitleTracks: 'Subtitle tracks', subtitleStyle: 'Subtitle style', fontFamily: 'Font family', fontSize: 'Font size', alignment: 'Alignment', horizontalPosition: 'Horizontal position', subtitlePosition: 'Vertical position', subtitleColor: 'Text color', outlineColor: 'Outline color', outlineWidth: 'Outline width', bold: 'Bold', italic: 'Italic', underline: 'Underline', embeddedTrack: 'Embedded', localTrack: 'Local file', remoteTrack: 'Remote URL', reset: 'Reset', playbackRate: 'Playback rate', noSubtitles: 'No subtitle tracks', loading: 'Loading', buffering: 'Buffering', seeking: 'Seeking', error: 'Playback error', unknownDuration: 'Live',
}

export const DEFAULT_FEATURES: Required<PlayerUiFeatureOptions> = {
  nextEpisode: true, volume: true, subtitles: true, pictureInPicture: true, theater: false, settings: true, statistics: true, about: true, fullscreen: true, preview: true,
}

export const UiErrorCodes = {
  UI_DESTROYED: 'UI_DESTROYED',
  UI_INVALID_CONTAINER: 'UI_INVALID_CONTAINER',
  UI_INVALID_OPTIONS: 'UI_INVALID_OPTIONS',
  UI_OPERATION_FAILED: 'UI_OPERATION_FAILED',
} as const

export type PlayerUiErrorCode = (typeof UiErrorCodes)[keyof typeof UiErrorCodes]

export class PlayerUiError extends Error {
  readonly code: PlayerUiErrorCode
  readonly recoverable: boolean

  constructor(code: PlayerUiErrorCode, message: string, recoverable = false) {
    super(message)
    this.name = 'PlayerUiError'
    this.code = code
    this.recoverable = recoverable
  }
}
