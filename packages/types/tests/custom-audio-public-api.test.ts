import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  AudioClockSnapshot,
  CustomAudioOptions,
  CustomAudioStats,
  EngineEventMap,
  MediaEngine,
  MXPlayerOptions,
  VideoFrameScheduleDecision,
} from '../src/index'
import { ErrorCodes } from '../src/index'

describe('custom audio public API', () => {
  it('publishes bounded audio options, statistics and clock metadata', () => {
    expectTypeOf<CustomAudioOptions>().toHaveProperty('maxBufferedDuration')
    expectTypeOf<CustomAudioOptions>().toHaveProperty('maxMessagePortPendingBlocks')
    expectTypeOf<CustomAudioStats>().toHaveProperty('renderedFrames')
    expectTypeOf<AudioClockSnapshot>().toHaveProperty('mediaTime')
    expectTypeOf<VideoFrameScheduleDecision['action']>().toEqualTypeOf<'wait' | 'present' | 'drop'>()
  })

  it('extends player and engine without exposing PCM or AudioData in events', () => {
    expectTypeOf<MXPlayerOptions>().toHaveProperty('customAudio')
    expectTypeOf<MediaEngine>().toHaveProperty('customAudioStats')
    expectTypeOf<MediaEngine>().toHaveProperty('audioClock')
    expectTypeOf<EngineEventMap['audiostatechange']>().not.toHaveProperty('pcm')
    expectTypeOf<EngineEventMap['clockupdate']>().not.toHaveProperty('data')
  })

  it('publishes stable audio and WebCodecs audio errors', () => {
    expect(ErrorCodes.AUDIO_AUTOPLAY_BLOCKED).toBe('AUDIO_AUTOPLAY_BLOCKED')
    expect(ErrorCodes.AUDIO_BUFFER_OVERFLOW).toBe('AUDIO_BUFFER_OVERFLOW')
    expect(ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID).toBe('WEBCODECS_AUDIO_CONFIG_INVALID')
    expect(ErrorCodes.WEBCODECS_AUDIO_DATA_INVALID).toBe('WEBCODECS_AUDIO_DATA_INVALID')
  })
})
