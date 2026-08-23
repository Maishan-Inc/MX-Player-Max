import type { PlayerUiLabels } from './contracts'
import { frameCounters, type StatsInput } from './stats'

export interface TroubleshootFinding {
  readonly code: string
  readonly message: string
}

export interface TroubleshootReport {
  readonly findings: readonly TroubleshootFinding[]
  readonly environment: readonly (readonly [string, string])[]
}

/** Ratio of dropped frames above which the report calls out a rendering problem. */
export const DROPPED_FRAME_THRESHOLD = 0.01

/**
 * Why a load failed, in terms a viewer can act on.
 *
 * The engine only surfaces a summary code — `STRATEGY_ALL_CANDIDATES_FAILED` when every
 * candidate was tried and rejected, `STRATEGY_NO_VIABLE_BACKEND` when none could even be
 * built. Neither says which codec or container is at fault; that lives in the per-candidate
 * attempt codes of the decision trace, which nothing used to read.
 */
export type PlaybackFailureCause = 'video-codec' | 'audio-codec' | 'container' | 'audio-channels' | 'no-backend'

const CAUSE_BY_CODE: Readonly<Record<string, PlaybackFailureCause>> = {
  WEBCODECS_NOT_SUPPORTED: 'video-codec',
  WEBCODECS_VIDEO_CONFIGURE_FAILED: 'video-codec',
  WEBCODECS_AUDIO_NOT_SUPPORTED: 'audio-codec',
  WEBCODECS_AUDIO_CONFIGURE_FAILED: 'audio-codec',
  AUDIO_CHANNEL_LAYOUT_UNSUPPORTED: 'audio-channels',
  CONTAINER_UNSUPPORTED: 'container',
  CONTAINER_INVALID: 'container',
  NATIVE_NOT_SUPPORTED: 'video-codec',
}

export function troubleshootCauseMessage(cause: PlaybackFailureCause, labels: PlayerUiLabels): string {
  if (cause === 'video-codec') return labels.troubleshootUnsupportedVideoCodec
  if (cause === 'audio-codec') return labels.troubleshootUnsupportedAudioCodec
  if (cause === 'audio-channels') return labels.troubleshootUnsupportedChannels
  if (cause === 'container') return labels.troubleshootUnsupportedContainer
  return labels.troubleshootNoBackend
}

/**
 * The most specific cause behind the current failure, or `null` when nothing failed.
 *
 * A trace with no candidates means the strategy could not build a backend at all, which is
 * itself the answer. Otherwise the first recognised attempt code wins: attempts are ordered
 * by candidate rank, so the best-scoring path's reason is the one worth showing.
 */
export function playbackFailureCause(input: StatsInput): { readonly cause: PlaybackFailureCause; readonly code: string } | null {
  const error = input.snapshot.lastError
  if (!error) return null
  const trace = input.decisionTrace
  if (trace && trace.sessionEpoch === input.snapshot.sessionEpoch) {
    // A path that was tried and failed explains the failure better than one that was never
    // offered, so real attempts are read before the withheld ones.
    const attempted = trace.attempts.filter((attempt) => attempt.status !== 'skipped')
    const skipped = trace.attempts.filter((attempt) => attempt.status === 'skipped')
    for (const attempt of [...attempted, ...skipped]) {
      const cause = attempt.errorCode === null || attempt.errorCode === undefined ? undefined : CAUSE_BY_CODE[attempt.errorCode]
      if (cause && attempt.errorCode) return { cause, code: attempt.errorCode }
    }
    if (trace.candidates.length === 0) return { cause: 'no-backend', code: error.code }
  }
  const direct = CAUSE_BY_CODE[error.code]
  return direct ? { cause: direct, code: error.code } : null
}

export function buildTroubleshootReport(input: StatsInput, labels: PlayerUiLabels, userAgent: string): TroubleshootReport {
  const { snapshot } = input
  const findings: TroubleshootFinding[] = []
  const counters = frameCounters(input)
  if (snapshot.lastError) findings.push({ code: snapshot.lastError.code, message: labels.troubleshootError })
  const failure = playbackFailureCause(input)
  if (failure) findings.push({ code: failure.code, message: troubleshootCauseMessage(failure.cause, labels) })
  if (counters !== null && counters.total > 60 && counters.dropped / counters.total > DROPPED_FRAME_THRESHOLD) {
    findings.push({ code: 'UI_DROPPED_FRAMES', message: labels.troubleshootDroppedFrames })
  }
  if (snapshot.buffering || (snapshot.state === 'playing' && snapshot.bufferedAhead < 1_000_000)) {
    findings.push({ code: 'UI_BUFFER_STARVED', message: labels.troubleshootBuffering })
  }
  if (input.customVideoStats !== null && input.audioClock !== null && input.audioClock.source !== 'audio-context') {
    findings.push({ code: 'UI_NO_AUDIO_CLOCK', message: labels.troubleshootNoAudioClock })
  }
  if (input.selection?.backend.kind === 'wasm') {
    findings.push({ code: 'UI_SOFTWARE_DECODE', message: labels.troubleshootSoftwareDecode })
  }
  const video = input.media?.tracks.find((track) => track.kind === 'video')
  const audio = input.media?.tracks.find((track) => track.kind === 'audio')
  const environment: (readonly [string, string])[] = [
    ['backend', input.selection?.backend.kind ?? '-'],
    ['renderer', input.rendererKind ?? input.selection?.backend.renderer ?? '-'],
    ['intent', input.selection?.intent ?? '-'],
    ['container', input.media?.container ?? '-'],
    ['videoCodec', video?.codec ?? video?.codecId ?? '-'],
    ['audioCodec', audio ? `${audio.codec ?? audio.codecId}${audio.channels === undefined ? '' : ` ${audio.channels}ch`}` : '-'],
    // Candidate ranking plus attempt outcome: the copied report has to carry the real reason.
    ['candidates', describeCandidates(input) ?? '-'],
    ['state', snapshot.state],
    ['bufferedAhead', `${(snapshot.bufferedAhead / 1_000_000).toFixed(2)} s`],
    ['frames', counters === null ? '-' : `${counters.dropped}/${counters.total}`],
    ['rate', `${snapshot.playbackRate}x`],
    ['viewport', `${Math.round(input.viewport.width)}x${Math.round(input.viewport.height)}@${input.viewport.devicePixelRatio}`],
    ['userAgent', userAgent],
  ]
  return { findings, environment }
}

function describeCandidates(input: StatsInput): string | null {
  const trace = input.decisionTrace
  if (!trace) return null
  const ranked = trace.candidates.map((candidate) => {
    const attempt = trace.attempts.find((entry) => entry.candidateId === candidate.candidateId)
    const outcome = attempt === undefined ? 'ranked' : attempt.errorCode ?? attempt.status
    return `${candidate.candidateId}:${outcome}`
  })
  // A withheld candidate has no ranking entry, so it would otherwise vanish from the report.
  const ids = new Set(trace.candidates.map((candidate) => candidate.candidateId))
  const withheld = trace.attempts
    .filter((attempt) => !ids.has(attempt.candidateId))
    .map((attempt) => `${attempt.candidateId}:${attempt.errorCode ?? attempt.status}`)
  const described = [...ranked, ...withheld]
  return described.length === 0 ? 'none' : described.join(' ')
}
