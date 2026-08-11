import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  ByteRange,
  CapabilityContext,
  DemuxPacket,
  EngineEventListener,
  EngineEventMap,
  MediaCapabilityReport,
  PlaybackDecisionAttempt,
  PlaybackDecisionCandidateTrace,
  PlaybackDecisionStatus,
  PlaybackDecisionTrace,
  PlatformScoreAdjustment,
  RangeReadResult,
  StrategyEvaluation,
  VideoCodecConfig,
} from '../src/index'
import { ErrorCodes } from '../src/index'

describe('@mx-player-max/types public API', () => {
  it('exports stable Phase 1 error codes', () => {
    expect(ErrorCodes.CAPABILITY_API_UNAVAILABLE).toBe('CAPABILITY_API_UNAVAILABLE')
    expect(ErrorCodes.STRATEGY_NO_VIABLE_BACKEND).toBe('STRATEGY_NO_VIABLE_BACKEND')
  })

  it('exports stable Phase 2 range and container contracts', () => {
    expect(ErrorCodes.RANGE_CONTENT_RANGE_INVALID).toBe('RANGE_CONTENT_RANGE_INVALID')
    expect(ErrorCodes.CONTAINER_LIMIT_EXCEEDED).toBe('CONTAINER_LIMIT_EXCEEDED')
    expectTypeOf<ByteRange>().toEqualTypeOf<{ start: number; endExclusive: number }>()
    expectTypeOf<RangeReadResult>().toHaveProperty('data')
    expectTypeOf<DemuxPacket['duration']>().toEqualTypeOf<number | null>()
  })

  it('exports the capability and score-only policy contracts', () => {
    expectTypeOf<MediaCapabilityReport>().toBeObject()
    expectTypeOf<CapabilityContext>().toBeObject()
    expectTypeOf<VideoCodecConfig>().toHaveProperty('codec')
    expectTypeOf<PlatformScoreAdjustment>().toHaveProperty('scoreDelta')
  })

  it('keeps event listeners keyed to their payload type', () => {
    expectTypeOf<EngineEventListener<'error'>>().parameter(0).toEqualTypeOf<EngineEventMap['error']>()
    expectTypeOf<EngineEventListener<'timeupdate'>>().parameter(0).toEqualTypeOf<EngineEventMap['timeupdate']>()
  })

  it('exports bounded playback decision contracts', () => {
    expectTypeOf<PlaybackDecisionStatus>().toEqualTypeOf<'evaluating' | 'initializing' | 'selected' | 'failed' | 'closed'>()
    expectTypeOf<PlaybackDecisionCandidateTrace>().toHaveProperty('initialScore')
    expectTypeOf<PlaybackDecisionCandidateTrace>().toHaveProperty('finalScore')
    expectTypeOf<PlaybackDecisionAttempt>().toHaveProperty('errorCode')
    expectTypeOf<PlaybackDecisionAttempt>().not.toHaveProperty('error')
    expectTypeOf<PlaybackDecisionTrace>().toHaveProperty('sessionEpoch')
    expectTypeOf<PlaybackDecisionTrace>().not.toHaveProperty('source')
    expectTypeOf<StrategyEvaluation>().toHaveProperty('baseCandidates')
    expectTypeOf<StrategyEvaluation>().toHaveProperty('adjustments')
    expectTypeOf<StrategyEvaluation>().toHaveProperty('rankedCandidates')
    expectTypeOf<StrategyEvaluation>().toHaveProperty('selection')
    expectTypeOf<EngineEventMap['decisionchange']>().toEqualTypeOf<{ trace: PlaybackDecisionTrace }>()
    expect(ErrorCodes.STRATEGY_ALL_CANDIDATES_FAILED).toBe('STRATEGY_ALL_CANDIDATES_FAILED')
  })
})
