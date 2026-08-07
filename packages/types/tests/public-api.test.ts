import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  CapabilityContext,
  EngineEventListener,
  EngineEventMap,
  MediaCapabilityReport,
  PlatformScoreAdjustment,
  VideoCodecConfig,
} from '../src/index'
import { ErrorCodes } from '../src/index'

describe('@mx-player-max/types public API', () => {
  it('exports stable Phase 1 error codes', () => {
    expect(ErrorCodes.CAPABILITY_API_UNAVAILABLE).toBe('CAPABILITY_API_UNAVAILABLE')
    expect(ErrorCodes.STRATEGY_NO_VIABLE_BACKEND).toBe('STRATEGY_NO_VIABLE_BACKEND')
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
})
