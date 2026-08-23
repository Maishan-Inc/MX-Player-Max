import { describe, expect, it } from 'vitest'
import type { MediaDescriptor, StrategyEvaluation } from '@mx-player-max/types'
import {
  beginDecisionAttempt,
  closeDecisionTrace,
  createDecisionTrace,
  failDecisionAttempt,
  failDecisionTrace,
  selectDecisionAttempt,
} from '../src/playback/decision-trace'

const media: MediaDescriptor = {
  container: 'webm',
  duration: 10_000_000,
  size: 50_000,
  mimeType: 'video/webm',
  tracks: [
    { id: 1, kind: 'video', codecId: 'V_VP8', codec: 'vp8', codecPrivate: new Uint8Array([1, 2, 3]) },
    { id: 2, kind: 'audio', codecId: 'A_OPUS', codec: 'opus' },
  ],
}

const baseNative = { id: 'native', kind: 'html-video', videoCodec: 'vp8', audioCodec: 'opus', renderer: 'native', score: 20, reasons: ['base'], requires: ['HTMLVideoElement'] } as const
const rankedNative = { ...baseNative, score: -80, reasons: ['base', 'issue'] } as const
const custom = { id: 'custom', kind: 'webcodecs', videoCodec: 'vp8', audioCodec: 'opus', renderer: 'webgpu', score: 10, reasons: ['custom'], requires: ['VideoDecoder'] } as const
const evaluation: StrategyEvaluation = {
  baseCandidates: [baseNative, custom],
  adjustments: [{ candidateId: 'native', scoreDelta: -100, reasons: ['issue'] }],
  rankedCandidates: [custom, rankedNative],
  selection: null,
}

describe('decision trace', () => {
  it('creates a deeply frozen and sanitized evaluation snapshot', () => {
    const trace = createDecisionTrace(evaluation, media, 'normal', 4, 100)

    expect(trace.status).toBe('evaluating')
    expect(trace.media).toEqual({ container: 'webm', mimeType: 'video/webm', videoCodec: 'vp8', audioCodec: 'opus', duration: 10_000_000 })
    expect(trace.candidates).toEqual([
      { candidateId: 'custom', kind: 'webcodecs', renderer: 'webgpu', initialScore: 10, finalScore: 10, reasons: ['custom'], requires: ['VideoDecoder'], adjustment: null },
      { candidateId: 'native', kind: 'html-video', renderer: 'native', initialScore: 20, finalScore: -80, reasons: ['base', 'issue'], requires: ['HTMLVideoElement'], adjustment: { candidateId: 'native', scoreDelta: -100, reasons: ['issue'] } },
    ])
    expect(Object.isFrozen(trace)).toBe(true)
    expect(Object.isFrozen(trace.candidates)).toBe(true)
    expect(Object.isFrozen(trace.candidates[1]?.reasons)).toBe(true)
    expect(JSON.stringify(trace)).not.toContain('codecPrivate')
    expect(JSON.stringify(trace)).not.toContain('50000')
  })

  it('records attempts without mutating prior snapshots', () => {
    const initial = createDecisionTrace(evaluation, media, 'normal', 4, 100)
    const initializing = beginDecisionAttempt(initial, custom, 0, 110)
    const firstFailed = failDecisionAttempt(initializing, custom, 0, 'WEBCODECS_CONFIGURE_FAILED', 120)
    const secondStarted = beginDecisionAttempt(firstFailed, rankedNative, 1, 130)
    const selected = selectDecisionAttempt(secondStarted, rankedNative, 1, 140)

    expect(initial.attempts).toEqual([])
    expect(initial.status).toBe('evaluating')
    expect(selected.status).toBe('selected')
    expect(selected.selectedCandidateId).toBe('native')
    expect(selected.attempts).toEqual([
      { index: 0, candidateId: 'custom', kind: 'webcodecs', status: 'failed', errorCode: 'WEBCODECS_CONFIGURE_FAILED' },
      { index: 1, candidateId: 'native', kind: 'html-video', status: 'selected', errorCode: null },
    ])
  })

  it('marks final failure and close with stable codes only', () => {
    const initial = createDecisionTrace(evaluation, media, 'normal', 4, 100)
    const failed = failDecisionTrace(initial, 'STRATEGY_ALL_CANDIDATES_FAILED', 150)
    const closed = closeDecisionTrace(failed, 160)

    expect(failed).toMatchObject({ status: 'failed', finalErrorCode: 'STRATEGY_ALL_CANDIDATES_FAILED' })
    expect(closed).toMatchObject({ status: 'closed', generatedAtMs: 160 })
    expect(Object.isFrozen(closed)).toBe(true)
  })

  /**
   * A candidate the strategy layer refused to produce leaves nothing but the summary error behind,
   * so the trace records it as skipped with the code the backend would have raised. Its index sits
   * past the ranked candidates because a real attempt is keyed by its rank.
   */
  it('records a withheld candidate as a skipped attempt without shadowing real attempts', () => {
    const withheld: StrategyEvaluation = {
      ...evaluation,
      rankedCandidates: [rankedNative],
      exclusions: [{ candidateId: 'custom', kind: 'webcodecs', errorCode: 'WEBCODECS_AUDIO_NOT_SUPPORTED', reasons: ['audio-codec-outside-engine-scope:vorbis'] }],
    }
    const initial = createDecisionTrace(withheld, media, 'filters', 4, 100)

    expect(initial.candidates.map((candidate) => candidate.candidateId)).toEqual(['native'])
    expect(initial.attempts).toEqual([
      { index: 1, candidateId: 'custom', kind: 'webcodecs', status: 'skipped', errorCode: 'WEBCODECS_AUDIO_NOT_SUPPORTED' },
    ])

    const failed = failDecisionAttempt(beginDecisionAttempt(initial, rankedNative, 0, 110), rankedNative, 0, 'NATIVE_NOT_SUPPORTED', 120)
    expect(failed.attempts).toEqual([
      { index: 1, candidateId: 'custom', kind: 'webcodecs', status: 'skipped', errorCode: 'WEBCODECS_AUDIO_NOT_SUPPORTED' },
      { index: 0, candidateId: 'native', kind: 'html-video', status: 'failed', errorCode: 'NATIVE_NOT_SUPPORTED' },
    ])
    expect(Object.isFrozen(initial.attempts[0])).toBe(true)
  })
})
