import { describe, expect, expectTypeOf, it } from 'vitest'
import type { EngineEventMap, MediaEngine, Micros, SubtitleClockSnapshot, SubtitleCue, SubtitleSourceLimits, SubtitleStyleStore } from '../src/index'
import { ErrorCodes } from '../src/index'

describe('subtitle public contracts', () => {
  it('exports stable subtitle error codes and cue/style contracts', () => {
    expect(ErrorCodes.SUBTITLE_SRT_INVALID).toBe('SUBTITLE_SRT_INVALID')
    expect(ErrorCodes.SUBTITLE_ASS_UNSUPPORTED_FEATURE).toBe('SUBTITLE_ASS_UNSUPPORTED_FEATURE')
    expect(ErrorCodes.SUBTITLE_SOURCE_CONFLICT).toBe('SUBTITLE_SOURCE_CONFLICT')
    expectTypeOf<SubtitleCue>().toHaveProperty('cueId')
    expectTypeOf<SubtitleCue['start']>().toEqualTypeOf<Micros>()
    expectTypeOf<SubtitleClockSnapshot['mediaTime']>().toEqualTypeOf<Micros>()
    expectTypeOf<SubtitleStyleStore>().toHaveProperty('load')
    expectTypeOf<SubtitleSourceLimits>().toHaveProperty('maxResponseChunks')
  })

  it('keeps subtitle events typed and safe', () => {
    expectTypeOf<EngineEventMap['subtitlecuechange']>().toHaveProperty('currentTime')
    expectTypeOf<EngineEventMap['subtitlewarning']>().toHaveProperty('diagnostic')
    expectTypeOf<MediaEngine['addSubtitleTrack']>().returns.toEqualTypeOf<Promise<import('../src/index').SubtitleTrack>>()
    expectTypeOf<MediaEngine['selectSubtitleTrack']>().returns.toEqualTypeOf<Promise<void>>()
  })
})
