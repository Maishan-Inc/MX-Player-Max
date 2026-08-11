import type {
  BackendCandidate,
  MediaDescriptor,
  PlaybackDecisionAttempt,
  PlaybackDecisionCandidateTrace,
  PlaybackDecisionTrace,
  PlaybackIntent,
  PlatformScoreAdjustment,
  StrategyEvaluation,
} from '@mx-player-max/types'

export function createDecisionTrace(
  evaluation: StrategyEvaluation,
  media: MediaDescriptor,
  intent: PlaybackIntent,
  sessionEpoch: number,
  generatedAtMs: number,
): PlaybackDecisionTrace {
  const bases = new Map(evaluation.baseCandidates.map((candidate) => [candidate.id, candidate]))
  const adjustments = new Map(evaluation.adjustments.map((adjustment) => [adjustment.candidateId, adjustment]))
  const candidates = evaluation.rankedCandidates.map((candidate) => createCandidateTrace(
    candidate,
    bases.get(candidate.id),
    adjustments.get(candidate.id) ?? null,
  ))
  const video = media.tracks.find((track) => track.kind === 'video')
  const audio = media.tracks.find((track) => track.kind === 'audio')
  return freezeTrace({
    schemaVersion: 1,
    sessionEpoch,
    generatedAtMs,
    status: 'evaluating',
    intent,
    media: {
      container: media.container,
      mimeType: media.mimeType ?? null,
      videoCodec: video?.codec ?? null,
      audioCodec: audio?.codec ?? null,
      duration: media.duration,
    },
    candidates,
    attempts: [],
    selectedCandidateId: null,
    finalErrorCode: null,
  })
}

export function beginDecisionAttempt(
  trace: PlaybackDecisionTrace,
  candidate: Readonly<BackendCandidate>,
  index: number,
  generatedAtMs: number,
): PlaybackDecisionTrace {
  return withAttempt(trace, candidate, index, 'initializing', null, generatedAtMs, 'initializing')
}

export function failDecisionAttempt(
  trace: PlaybackDecisionTrace,
  candidate: Readonly<BackendCandidate>,
  index: number,
  errorCode: string,
  generatedAtMs: number,
): PlaybackDecisionTrace {
  return withAttempt(trace, candidate, index, 'failed', errorCode, generatedAtMs, 'initializing')
}

export function selectDecisionAttempt(
  trace: PlaybackDecisionTrace,
  candidate: Readonly<BackendCandidate>,
  index: number,
  generatedAtMs: number,
): PlaybackDecisionTrace {
  const updated = withAttempt(trace, candidate, index, 'selected', null, generatedAtMs, 'selected')
  return freezeTrace({ ...updated, selectedCandidateId: candidate.id, finalErrorCode: null })
}

export function failDecisionTrace(
  trace: PlaybackDecisionTrace,
  finalErrorCode: string,
  generatedAtMs: number,
): PlaybackDecisionTrace {
  return freezeTrace({ ...trace, generatedAtMs, status: 'failed', selectedCandidateId: null, finalErrorCode })
}

export function closeDecisionTrace(trace: PlaybackDecisionTrace, generatedAtMs: number): PlaybackDecisionTrace {
  return freezeTrace({ ...trace, generatedAtMs, status: 'closed' })
}

function withAttempt(
  trace: PlaybackDecisionTrace,
  candidate: Readonly<BackendCandidate>,
  index: number,
  status: PlaybackDecisionAttempt['status'],
  errorCode: string | null,
  generatedAtMs: number,
  traceStatus: PlaybackDecisionTrace['status'],
): PlaybackDecisionTrace {
  const attempt: PlaybackDecisionAttempt = {
    index,
    candidateId: candidate.id,
    kind: candidate.kind,
    status,
    errorCode,
  }
  const attempts = [...trace.attempts]
  const existing = attempts.findIndex((value) => value.index === index)
  if (existing >= 0) attempts[existing] = attempt
  else attempts.push(attempt)
  return freezeTrace({ ...trace, generatedAtMs, status: traceStatus, attempts })
}

function createCandidateTrace(
  candidate: Readonly<BackendCandidate>,
  base: Readonly<BackendCandidate> | undefined,
  adjustment: Readonly<PlatformScoreAdjustment> | null,
): PlaybackDecisionCandidateTrace {
  return {
    candidateId: candidate.id,
    kind: candidate.kind,
    renderer: candidate.renderer,
    initialScore: base?.score ?? candidate.score,
    finalScore: candidate.score,
    reasons: [...candidate.reasons],
    requires: [...candidate.requires],
    adjustment: adjustment === null ? null : {
      candidateId: adjustment.candidateId,
      scoreDelta: adjustment.scoreDelta,
      reasons: [...adjustment.reasons],
    },
  }
}

function freezeTrace(trace: PlaybackDecisionTrace): PlaybackDecisionTrace {
  const candidates = trace.candidates.map((candidate) => Object.freeze({
    ...candidate,
    reasons: Object.freeze([...candidate.reasons]),
    requires: Object.freeze([...candidate.requires]),
    adjustment: candidate.adjustment === null ? null : Object.freeze({
      ...candidate.adjustment,
      reasons: Object.freeze([...candidate.adjustment.reasons]),
    }),
  }))
  const attempts = trace.attempts.map((attempt) => Object.freeze({ ...attempt }))
  return Object.freeze({
    ...trace,
    media: Object.freeze({ ...trace.media }),
    candidates: Object.freeze(candidates),
    attempts: Object.freeze(attempts),
  })
}
