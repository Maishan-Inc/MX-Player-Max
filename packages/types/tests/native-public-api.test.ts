import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  MediaEngine,
  Micros,
  MXPlayerOptions,
  NativeCrossOrigin,
  NativeMediaFeatures,
  NativeMediaOptions,
  NativePlaybackStats,
} from '../src/index'
import { ErrorCodes } from '../src/index'

describe('native public API', () => {
  it('exports native options, features and statistics with explicit units', () => {
    expectTypeOf<NativeCrossOrigin>().toEqualTypeOf<'anonymous' | 'use-credentials' | null>()
    expectTypeOf<NativeMediaOptions>().toHaveProperty('metadataTimeoutMs')
    expectTypeOf<NativeMediaFeatures>().toHaveProperty('requestVideoFrameCallback')
    expectTypeOf<NativePlaybackStats['mediaTime']>().toEqualTypeOf<Micros | null>()
  })

  it('adds native options without changing required source and target fields', () => {
    expectTypeOf<MXPlayerOptions>().toHaveProperty('native')
    expectTypeOf<MediaEngine>().toHaveProperty('requestPictureInPicture')
  })

  it('publishes stable native and engine error codes', () => {
    expect(ErrorCodes.ENGINE_CLOSED).toBe('ENGINE_CLOSED')
    expect(ErrorCodes.NATIVE_CUSTOM_HEADERS_UNSUPPORTED).toBe('NATIVE_CUSTOM_HEADERS_UNSUPPORTED')
    expect(ErrorCodes.NATIVE_AUTOPLAY_BLOCKED).toBe('NATIVE_AUTOPLAY_BLOCKED')
    expect(ErrorCodes.NATIVE_PIP_UNSUPPORTED).toBe('NATIVE_PIP_UNSUPPORTED')
  })
})

