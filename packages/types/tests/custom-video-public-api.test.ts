import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  CustomVideoOptions,
  CustomVideoStats,
  DecodedVideoFrame,
  EngineEventMap,
  MediaEngine,
  Micros,
  MXPlayerOptions,
} from '../src/index'
import { ErrorCodes } from '../src/index'

describe('custom video public API', () => {
  it('publishes bounded custom video options and microsecond frame metadata', () => {
    expectTypeOf<CustomVideoOptions>().toHaveProperty('maxDecodedFrames')
    expectTypeOf<CustomVideoOptions>().toHaveProperty('maxBufferedDuration')
    expectTypeOf<DecodedVideoFrame['timestamp']>().toEqualTypeOf<Micros>()
    expectTypeOf<DecodedVideoFrame['duration']>().toEqualTypeOf<Micros | null>()
    expectTypeOf<CustomVideoStats['bufferedDuration']>().toEqualTypeOf<Micros>()
  })

  it('extends options, engine frame access, statistics and ownership-safe events', () => {
    expectTypeOf<MXPlayerOptions>().toHaveProperty('customVideo')
    expectTypeOf<MediaEngine>().toHaveProperty('customVideoStats')
    expectTypeOf<MediaEngine>().toHaveProperty('readVideoFrame')
    expectTypeOf<EngineEventMap['frameavailable']>().not.toHaveProperty('frame')
  })

  it('publishes stable custom and WebCodecs error codes', () => {
    expect(ErrorCodes.CUSTOM_BACKEND_UNAVAILABLE).toBe('CUSTOM_BACKEND_UNAVAILABLE')
    expect(ErrorCodes.CUSTOM_FRAME_ACCESS_UNAVAILABLE).toBe('CUSTOM_FRAME_ACCESS_UNAVAILABLE')
    expect(ErrorCodes.WEBCODECS_CONFIGURE_FAILED).toBe('WEBCODECS_CONFIGURE_FAILED')
    expect(ErrorCodes.WEBCODECS_QUEUE_OVERFLOW).toBe('WEBCODECS_QUEUE_OVERFLOW')
    expect(ErrorCodes.WEBCODECS_WORKER_FAILED).toBe('WEBCODECS_WORKER_FAILED')
  })
})
