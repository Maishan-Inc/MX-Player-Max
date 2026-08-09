import type {
  EngineError,
  PlaybackChangeReason,
  PlaybackControlCapabilities,
  PlaybackErrorSummary,
  PlaybackSnapshot,
  PlaybackState,
  PlaybackTimeRange,
  PresentationMode,
  Micros,
} from '@mx-player-max/types'
import { bufferedAhead, normalizeMicros, normalizePlaybackRanges, type RawPlaybackRange } from './ranges'

export interface PlaybackSnapshotInput {
  readonly sessionEpoch?: number
  readonly state?: PlaybackState
  readonly paused?: boolean
  readonly currentTime?: number | null
  readonly duration?: number | null
  readonly played?: readonly RawPlaybackRange[] | TimeRanges | null
  readonly buffered?: readonly RawPlaybackRange[] | TimeRanges | null
  readonly bufferedAhead?: number
  readonly volume?: number
  readonly muted?: boolean
  readonly playbackRate?: number
  readonly seeking?: boolean
  readonly buffering?: boolean
  readonly presentationMode?: PresentationMode
  readonly capabilities?: Partial<PlaybackControlCapabilities>
  readonly lastError?: EngineError | PlaybackErrorSummary | null
}

const DEFAULT_CAPABILITIES: PlaybackControlCapabilities = Object.freeze({
  seek: false,
  volume: false,
  playbackRate: false,
  fullscreen: false,
  pictureInPicture: false,
  preview: false,
})

export function createPlaybackSnapshot(sessionEpoch = 0): PlaybackSnapshot {
  return Object.freeze({
    sessionEpoch,
    state: 'idle',
    paused: true,
    currentTime: null,
    duration: null,
    played: Object.freeze([]) as readonly PlaybackTimeRange[],
    buffered: Object.freeze([]) as readonly PlaybackTimeRange[],
    bufferedAhead: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    seeking: false,
    buffering: false,
    presentationMode: 'inline',
    capabilities: DEFAULT_CAPABILITIES,
    lastError: null,
  })
}

export function summarizePlaybackError(error: EngineError | PlaybackErrorSummary | null | undefined): PlaybackErrorSummary | null {
  if (!error) return null
  const code = typeof error.code === 'string' && error.code.length > 0 ? error.code : 'ENGINE_OPERATION_FAILED'
  return Object.freeze({ code, recoverable: error.recoverable === true })
}

export function updatePlaybackSnapshot(
  previous: PlaybackSnapshot,
  input: PlaybackSnapshotInput,
): PlaybackSnapshot {
  const sessionEpoch = input.sessionEpoch
  const duration = input.duration === undefined ? previous.duration : normalizeMicros(input.duration)
  const currentTime = input.currentTime === undefined ? previous.currentTime : normalizeMicros(input.currentTime)
  const played = input.played === undefined
    ? previous.played
    : normalizePlaybackRanges(input.played, duration)
  const buffered = input.buffered === undefined
    ? previous.buffered
    : normalizePlaybackRanges(input.buffered, duration)
  const capabilities: PlaybackControlCapabilities = Object.freeze({
    ...previous.capabilities,
    ...input.capabilities,
  })
  const next = {
    ...previous,
    sessionEpoch: sessionEpoch !== undefined && Number.isSafeInteger(sessionEpoch) && sessionEpoch >= 0 ? sessionEpoch : previous.sessionEpoch,
    ...(input.state === undefined ? {} : { state: input.state }),
    ...(input.paused === undefined ? {} : { paused: input.paused }),
    currentTime,
    duration,
    played,
    buffered,
    bufferedAhead: input.bufferedAhead === undefined
      ? bufferedAhead(buffered, currentTime)
      : Math.max(0, normalizeMicros(input.bufferedAhead) ?? 0),
    ...(input.volume === undefined ? {} : { volume: normalizeVolume(input.volume, previous.volume) }),
    ...(input.muted === undefined ? {} : { muted: input.muted }),
    ...(input.playbackRate === undefined ? {} : { playbackRate: normalizeRate(input.playbackRate, previous.playbackRate) }),
    ...(input.seeking === undefined ? {} : { seeking: input.seeking }),
    ...(input.buffering === undefined ? {} : { buffering: input.buffering }),
    ...(input.presentationMode === undefined ? {} : { presentationMode: input.presentationMode }),
    capabilities,
    ...(input.lastError === undefined ? {} : { lastError: summarizePlaybackError(input.lastError) }),
  }
  return Object.freeze(next)
}

export function snapshotReasonForStateChange(previous: PlaybackSnapshot, next: PlaybackSnapshot): PlaybackChangeReason {
  if (previous.lastError?.code !== next.lastError?.code) return 'error'
  if (previous.presentationMode !== next.presentationMode) return 'presentation'
  if (JSON.stringify(previous.capabilities) !== JSON.stringify(next.capabilities)) return 'capabilities'
  if (previous.volume !== next.volume || previous.muted !== next.muted) return 'volume'
  if (previous.playbackRate !== next.playbackRate) return 'rate'
  if (previous.currentTime !== next.currentTime || previous.duration !== next.duration || previous.played !== next.played) return 'time'
  if (previous.bufferedAhead !== next.bufferedAhead || previous.buffered !== next.buffered) return 'buffer'
  if (previous.state !== next.state || previous.paused !== next.paused || previous.seeking !== next.seeking || previous.buffering !== next.buffering) return 'state'
  return 'state'
}

function normalizeVolume(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback
}

function normalizeRate(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}
