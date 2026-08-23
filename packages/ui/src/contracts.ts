import type { MXPlayer } from '@mx-player-max/sdk'

export interface TheaterModeAdapter {
  getState(): boolean
  setState(active: boolean): void | Promise<void>
  subscribe(listener: (active: boolean) => void): () => void
}

/**
 * Which playback path the session runs on.
 *
 * `native` is the HTML video element. Both custom values are the WebCodecs pipeline; they
 * differ in the renderer, and only `custom-webgpu` can carry the AI stages.
 */
export type PlayerRenderMode = 'native' | 'custom-webgpu' | 'custom-fallback'

/**
 * Switching the render path means reloading the session with different engine options, which
 * is the host's call, not the chrome's. The UI only renders the choice and reports it, exactly
 * like {@link TheaterModeAdapter}.
 */
export interface RenderModeAdapter {
  getState(): PlayerRenderMode
  setState(mode: PlayerRenderMode): void | Promise<void>
  subscribe(listener: (mode: PlayerRenderMode) => void): () => void
}

/** Locales shipped with the player chrome. `auto` resolves the host language at attach time. */
export type PlayerUiLocale = 'en' | 'zh-CN' | 'zh-TW' | 'ja'

export interface PlayerUiFeatureOptions {
  readonly nextEpisode?: boolean
  readonly volume?: boolean
  readonly subtitles?: boolean
  readonly pictureInPicture?: boolean
  readonly theater?: boolean
  readonly settings?: boolean
  /** Render-path selector inside the settings panel. Needs a `renderMode` adapter to appear. */
  readonly renderMode?: boolean
  /** AI post-processing toggles inside the settings panel. */
  readonly aiPostProcess?: boolean
  readonly statistics?: boolean
  readonly about?: boolean
  readonly fullscreen?: boolean
  readonly preview?: boolean
  /** Right-click menu on the player surface. Disabling it restores the browser menu. */
  readonly contextMenu?: boolean
  readonly loop?: boolean
  readonly miniPlayer?: boolean
  /** Copy video URL, copy URL at current time and copy embed code menu entries. */
  readonly share?: boolean
  /** Copy debug info and the troubleshooting report. */
  readonly troubleshoot?: boolean
  /** Lock the chrome while fullscreen or theater mode is active. */
  readonly lockControls?: boolean
}

export interface NextEpisodeControlOptions {
  readonly onRequest?: () => void | Promise<void>
  readonly unavailableBehavior?: 'disabled' | 'hidden'
}

/**
 * Addresses the context menu copies. The UI never derives a media address from the engine
 * internals; anything not supplied here falls back to the hosting page URL.
 */
export interface PlayerUiShareOptions {
  readonly videoUrl?: string
  readonly pageUrl?: string
  readonly embedUrl?: string
  readonly embedWidth?: number
  readonly embedHeight?: number
  /** Query parameter carrying the start offset in whole seconds. Defaults to `t`. */
  readonly timeParam?: string
  readonly title?: string
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
  /** Font-picker page of the subtitle menu. */
  readonly subtitleFont: string
  /** Opens the drag-to-edit mode from the subtitle menu header. */
  readonly subtitleEdit: string
  /** One-line instruction shown by the subtitle edit bar. */
  readonly subtitleEditHint: string
  /** Stand-in line rendered by the edit guide when no cue is on screen. */
  readonly subtitleSample: string
  /** Play-button tooltip while the subtitle menu holds the picture still. */
  readonly subtitleHold: string
  readonly done: string
  readonly lockControls: string
  readonly unlockControls: string
  readonly fontFamily: string
  readonly fontSize: string
  /* Font list of the subtitle menu */
  readonly fontSystem: string
  readonly fontSans: string
  readonly fontSerif: string
  readonly fontKai: string
  readonly fontRounded: string
  readonly fontMono: string
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
  /* Right-click menu */
  readonly contextMenu: string
  readonly loop: string
  readonly miniPlayer: string
  readonly exitMiniPlayer: string
  readonly copyVideoUrl: string
  readonly copyVideoUrlAtTime: string
  readonly copyEmbedCode: string
  readonly copyDebugInfo: string
  readonly troubleshoot: string
  readonly copied: string
  readonly copyFailed: string
  /* Stats for nerds rows */
  readonly statsVideoId: string
  readonly statsViewport: string
  readonly statsResolution: string
  readonly statsVolume: string
  readonly statsCodecs: string
  readonly statsColor: string
  readonly statsConnection: string
  readonly statsNetwork: string
  readonly statsBufferHealth: string
  readonly statsMystery: string
  readonly statsDate: string
  /** Frame counter template. `{dropped}` and `{total}` are substituted. */
  readonly statsFrames: string
  readonly statsUnknown: string
  /* Troubleshooting report */
  readonly troubleshootHealthy: string
  readonly troubleshootFindings: string
  readonly troubleshootDroppedFrames: string
  readonly troubleshootBuffering: string
  readonly troubleshootError: string
  readonly troubleshootNoAudioClock: string
  readonly troubleshootSoftwareDecode: string
  /* Why a load failed. The engine only reports a summary code; these name the actual cause. */
  readonly troubleshootUnsupportedVideoCodec: string
  readonly troubleshootUnsupportedAudioCodec: string
  readonly troubleshootUnsupportedContainer: string
  readonly troubleshootUnsupportedChannels: string
  /** No backend could even be built for this media. */
  readonly troubleshootNoBackend: string
  readonly troubleshootEnvironment: string
  readonly troubleshootCopyReport: string
  /* Render-path section of the settings panel */
  readonly renderMode: string
  readonly renderModeNative: string
  readonly renderModeWebGpu: string
  readonly renderModeFallback: string
  /** Caption under the selector naming the mode the AI toggles need. */
  readonly renderModeHint: string
  /* AI post-processing section of the settings panel */
  readonly aiEnhance: string
  readonly aiSuperResolution: string
  readonly aiInterpolation: string
  /** Shown under a toggle the current renderer cannot support. */
  readonly aiUnavailableRendererPath: string
  /** Shown when the host did not configure a model root. */
  readonly aiUnavailableModel: string
  /** Shown when the adapter is missing or software-only. */
  readonly aiUnavailableDevice: string
  /** Shown for a stage that exists as an interface but has no verified implementation. */
  readonly aiUnavailableNotImplemented: string
}

export interface PlayerUiErrorSummary {
  readonly code: PlayerUiErrorCode
  readonly recoverable: boolean
}

export interface PlayerUiOptions {
  readonly theme?: 'dark' | 'light' | 'system'
  /** Built-in label pack. `auto` follows the host document language. Defaults to `en`. */
  readonly locale?: PlayerUiLocale | 'auto'
  readonly features?: PlayerUiFeatureOptions
  readonly labels?: Readonly<Partial<PlayerUiLabels>>
  readonly share?: PlayerUiShareOptions
  readonly autoHideDelayMs?: number
  readonly nextEpisode?: NextEpisodeControlOptions
  readonly theaterMode?: TheaterModeAdapter
  readonly renderMode?: RenderModeAdapter
  readonly onError?: (error: PlayerUiErrorSummary) => void
}

export interface PlayerUiController {
  readonly attached: boolean
  attach(container: HTMLElement): void
  update(options: PlayerUiOptions): void
  destroy(): void
}

type PlayerUiRequiredPlayer = Pick<MXPlayer, 'playback' | 'state' | 'play' | 'pause' | 'seek' | 'setVolume' | 'setMuted' | 'setPlaybackRate' | 'requestFullscreen' | 'exitFullscreen' | 'requestPictureInPicture' | 'exitPictureInPicture' | 'subtitleTracks' | 'selectedSubtitleTrack' | 'subtitleState' | 'subtitleStyle' | 'setSubtitleStyle' | 'resetSubtitleStyle' | 'selectSubtitleTrack' | 'on' | 'off' | 'requestPreview'>

/**
 * Read-only telemetry the statistics overlay and the troubleshooting report consume. It is
 * optional so a host may pass a reduced player object; every reader guards for absence.
 */
type PlayerUiTelemetryPlayer = Partial<Pick<MXPlayer, 'media' | 'selection' | 'decisionTrace' | 'nativeStats' | 'customVideoStats' | 'customAudioStats' | 'audioClock' | 'rendererKind' | 'rendererStats' | 'setAiPostProcess'>>

export type PlayerUiPlayer = PlayerUiRequiredPlayer & PlayerUiTelemetryPlayer

export const DEFAULT_LABELS: PlayerUiLabels = {
  play: 'Play', pause: 'Pause', replay: 'Replay', nextEpisode: 'Next episode', mute: 'Mute', unmute: 'Unmute', volume: 'Volume',
  seek: 'Seek', subtitles: 'Subtitles', pictureInPicture: 'Picture in picture', exitPictureInPicture: 'Exit picture in picture', theater: 'Theater mode', exitTheater: 'Exit theater mode', settings: 'Settings', statistics: 'Stats for nerds', about: 'About',
  fullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen', close: 'Close', subtitleOff: 'Off', subtitleTracks: 'Subtitle tracks', subtitleStyle: 'Subtitle style', subtitleFont: 'Choose font', subtitleEdit: 'Edit subtitle style', subtitleEditHint: 'Drag the subtitle to move it, drag the top or bottom edge to resize', subtitleSample: 'Subtitle sample', subtitleHold: 'Paused while the subtitle menu is open', done: 'Done', lockControls: 'Lock controls', unlockControls: 'Unlock controls', fontFamily: 'Font family', fontSize: 'Font size', fontSystem: 'System default', fontSans: 'Sans', fontSerif: 'Serif', fontKai: 'Kai', fontRounded: 'Rounded', fontMono: 'Monospace', alignment: 'Alignment', horizontalPosition: 'Horizontal position', subtitlePosition: 'Vertical position', subtitleColor: 'Text color', outlineColor: 'Outline color', outlineWidth: 'Outline width', bold: 'Bold', italic: 'Italic', underline: 'Underline', embeddedTrack: 'Embedded', localTrack: 'Local file', remoteTrack: 'Remote URL', reset: 'Reset', playbackRate: 'Playback rate', noSubtitles: 'No subtitle tracks', loading: 'Loading', buffering: 'Buffering', seeking: 'Seeking', error: 'Playback error', unknownDuration: 'Live',
  contextMenu: 'Player menu', loop: 'Loop', miniPlayer: 'Miniplayer', exitMiniPlayer: 'Exit miniplayer', copyVideoUrl: 'Copy video URL', copyVideoUrlAtTime: 'Copy video URL at current time', copyEmbedCode: 'Copy embed code', copyDebugInfo: 'Copy debug info', troubleshoot: 'Troubleshoot playback issue', copied: 'Copied to the clipboard', copyFailed: 'The clipboard is unavailable',
  statsVideoId: 'Video ID / sCPN', statsViewport: 'Viewport / Frames', statsResolution: 'Current / Optimal Res', statsVolume: 'Volume / Normalized', statsCodecs: 'Codecs', statsColor: 'Color', statsConnection: 'Connection Speed', statsNetwork: 'Network Activity', statsBufferHealth: 'Buffer Health', statsMystery: 'Mystery Text', statsDate: 'Date', statsFrames: '{dropped} dropped of {total}', statsUnknown: 'n/a',
  aiEnhance: 'AI enhancement', aiSuperResolution: 'Super resolution', aiInterpolation: 'Frame interpolation',
  renderMode: 'Render mode', renderModeNative: 'Native playback', renderModeWebGpu: 'WebGPU custom pipeline', renderModeFallback: 'WebGL2 custom pipeline',
  renderModeHint: 'AI enhancement runs only on the WebGPU custom pipeline.',
  aiUnavailableRendererPath: 'Switch the render mode to the WebGPU custom pipeline to enable this.',
  aiUnavailableModel: 'The host has not configured a model root for AI post-processing.',
  aiUnavailableDevice: 'This device has no usable WebGPU adapter.',
  aiUnavailableNotImplemented: 'Not available yet in this build.',
  troubleshootHealthy: 'No playback problem was detected.', troubleshootFindings: 'Findings', troubleshootDroppedFrames: 'Frames are being dropped. Lower the resolution, close other GPU-heavy tabs, or switch the playback intent back to Normal.', troubleshootBuffering: 'Playback is starving for data. Check the connection and confirm the server answers HTTP Range requests with 206 Partial Content.', troubleshootError: 'The engine reported an error. The code below identifies the failing stage.', troubleshootNoAudioClock: 'No audio clock is running, so video timing follows the media wall clock and may drift.', troubleshootSoftwareDecode: 'A WASM decoder is active. Hardware decoding is unavailable for this codec in this browser.',
  troubleshootUnsupportedVideoCodec: 'This video codec cannot be decoded here. H.264, VP8, VP9 and AV1 play; HEVC does not.',
  troubleshootUnsupportedAudioCodec: 'This audio codec cannot be decoded here. AAC, Opus and MP3 play; AC-3, DTS, FLAC and Vorbis do not.',
  troubleshootUnsupportedContainer: 'This container cannot be read. MP4, WebM and Matroska are supported.',
  troubleshootUnsupportedChannels: 'Only mono and stereo audio play. This track has more channels.',
  troubleshootNoBackend: 'No playback path could handle this media, so nothing was attempted.',
  troubleshootEnvironment: 'Environment', troubleshootCopyReport: 'Copy report',
}

export const DEFAULT_FEATURES: Required<PlayerUiFeatureOptions> = {
  nextEpisode: true, volume: true, subtitles: true, pictureInPicture: true, theater: false, settings: true, renderMode: true, aiPostProcess: true, statistics: true, about: true, fullscreen: true, preview: true,
  contextMenu: true, loop: true, miniPlayer: true, share: true, troubleshoot: true, lockControls: true,
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
