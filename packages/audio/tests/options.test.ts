import { describe, expect, it } from 'vitest'
import type { CustomAudioOptions } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { DEFAULT_CUSTOM_AUDIO_OPTIONS, resolveCustomAudioOptions } from '../src/index'

describe('custom audio options', () => {
  it('publishes deterministic bounded defaults', () => {
    expect(resolveCustomAudioOptions()).toEqual({ ...DEFAULT_CUSTOM_AUDIO_OPTIONS, outputSampleRate: null })
  })

  it.each<CustomAudioOptions>([
    { maxDecodeQueueSize: 0 },
    { maxDecodeQueueSize: 129 },
    { maxBufferedDuration: 19_999 },
    { maxBufferedDuration: 30_000_001 },
    { maxBufferedDuration: 100_000, lowWaterMark: 100_000 },
    { maxBufferedDuration: 100_000, startBufferDuration: 100_001 },
    { maxMessagePortPendingBlocks: 65 },
    { operationTimeoutMs: 0 },
    { latencyHint: 11 },
    { outputSampleRate: 7_999 },
    { outputSampleRate: 192_001 },
  ])('rejects invalid or unbounded values %#', (options) => {
    expect(() => resolveCustomAudioOptions(options)).toThrowError(expect.objectContaining({ code: ErrorCodes.AUDIO_INVALID_QUEUE_CONFIG }))
  })
})
