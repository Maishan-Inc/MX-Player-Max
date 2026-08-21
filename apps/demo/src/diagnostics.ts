import type { MXPlayer } from '@mx-player-max/sdk'
import type {
  CapabilityContext,
  CapabilitySupport,
  PlaybackDecisionTrace,
  PlaybackSelection,
  PlaybackSnapshot,
  RendererStats,
  SubtitleState,
  SubtitleTrack,
} from '@mx-player-max/types'

export type DiagnosticStatus = 'empty' | 'loading' | 'ready' | 'failed'

export type DiagnosticState<T> =
  | { readonly status: 'empty' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'failed'; readonly error: string; readonly value: T | null }

export interface SupportPresentation {
  readonly tone: SupportTone
}

/** Capability evidence tone. The panel maps it onto localized copy. */
export type SupportTone = 'supported' | 'unsupported' | 'unknown'

export interface ProbeDiagnostics {
  readonly browser: string
  readonly platform: string
  readonly crossOriginIsolated: boolean
  readonly nativePlayable: CapabilitySupport
  readonly webCodecsPlayable: CapabilitySupport
  readonly webGpu: boolean
  readonly wasmThreads: boolean
}

export interface RuntimeDiagnostics {
  readonly playback: PlaybackSnapshot
  readonly selection: PlaybackSelection | null
  readonly rendererKind: string | null
  readonly rendererStats: RendererStats | null
  readonly droppedFrames: number | null
  readonly clockSource: string | null
}

export interface SubtitleDiagnostics {
  readonly state: SubtitleState
  readonly tracks: readonly SubtitleTrack[]
  readonly selectedTrackId: string | null
}

export function emptyDiagnostic<T>(): DiagnosticState<T> { return { status: 'empty' } }
export function loadingDiagnostic<T>(): DiagnosticState<T> { return { status: 'loading' } }
export function readyDiagnostic<T>(value: T): DiagnosticState<T> { return { status: 'ready', value } }
export function failedDiagnostic<T>(error: string, value: T | null = null): DiagnosticState<T> {
  return { status: 'failed', error, value }
}

export function supportPresentation(value: CapabilitySupport | boolean): SupportPresentation {
  if (value === true || value === 'supported') return { tone: 'supported' }
  if (value === false || value === 'unsupported') return { tone: 'unsupported' }
  return { tone: 'unknown' }
}

export function probeDiagnostics(context: CapabilityContext): ProbeDiagnostics {
  const { snapshot, media } = context
  const version = snapshot.browserVersion ? ` ${snapshot.browserVersion}` : ''
  return {
    browser: `${snapshot.browser}${version}`,
    platform: snapshot.platform,
    crossOriginIsolated: snapshot.crossOriginIsolated,
    nativePlayable: media.native.playable,
    webCodecsPlayable: media.webCodecs.playable,
    webGpu: snapshot.webGpu,
    wasmThreads: snapshot.wasmThreads,
  }
}

export function runtimeDiagnostics(player: MXPlayer): RuntimeDiagnostics {
  const rendererStats = player.rendererStats
  const nativeStats = player.nativeStats
  const customStats = player.customVideoStats
  return {
    playback: player.playback,
    selection: player.selection,
    rendererKind: player.rendererKind,
    rendererStats,
    droppedFrames: rendererStats?.droppedFrames ?? nativeStats?.droppedFrames ?? customStats?.droppedFrames ?? null,
    clockSource: player.audioClock?.source ?? null,
  }
}

export function subtitleDiagnostics(player: MXPlayer): SubtitleDiagnostics {
  return {
    state: player.subtitleState,
    tracks: player.subtitleTracks,
    selectedTrackId: player.selectedSubtitleTrack,
  }
}

export function decisionDiagnostic(trace: PlaybackDecisionTrace): DiagnosticState<PlaybackDecisionTrace> {
  if (trace.status === 'evaluating' || trace.status === 'initializing') return loadingDiagnostic()
  if (trace.status === 'failed') return failedDiagnostic(trace.finalErrorCode ?? 'PLAYBACK_DECISION_FAILED', trace)
  if (trace.status === 'closed') return emptyDiagnostic()
  return readyDiagnostic(trace)
}

/** Returns `null` for an unusable reading so the caller can supply localized copy. */
export function secondsFromMicros(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  return `${(value / 1_000_000).toFixed(2)} s`
}
