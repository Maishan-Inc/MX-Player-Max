import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  EngineEventMap,
  MediaEngine,
  MediaPreviewImage,
  MediaPreviewOptions,
  MediaPreviewProvider,
  MediaPreviewProviderRequest,
  MediaPreviewProviderResult,
  MediaPreviewRequest,
  MXPlayerOptions,
  PlaybackChangeReason,
  PlaybackDecisionTrace,
  PlaybackSnapshot,
  PlaybackTimeRange,
} from '../src/index'
import { ErrorCodes } from '../src/index'

describe('Phase 9 playback and preview public API', () => {
  it('exports the path-independent playback snapshot', () => {
    expectTypeOf<PlaybackTimeRange>().toEqualTypeOf<{ readonly start: number; readonly end: number }>()
    expectTypeOf<PlaybackSnapshot>().toHaveProperty('sessionEpoch')
    expectTypeOf<PlaybackSnapshot['duration']>().toEqualTypeOf<number | null>()
    expectTypeOf<PlaybackSnapshot['buffered']>().toEqualTypeOf<readonly PlaybackTimeRange[]>()
    expectTypeOf<PlaybackChangeReason>().toEqualTypeOf<
      'load' | 'state' | 'time' | 'buffer' | 'volume' | 'rate' | 'presentation' | 'capabilities' | 'error'
    >()
    expectTypeOf<EngineEventMap['playbackchange']>().toHaveProperty('snapshot')
    expectTypeOf<MediaEngine['playback']>().toEqualTypeOf<PlaybackSnapshot>()
    expectTypeOf<MediaEngine['decisionTrace']>().toEqualTypeOf<PlaybackDecisionTrace | null>()
  })

  it('keeps preview requests isolated from media internals', () => {
    expectTypeOf<MediaPreviewRequest>().toHaveProperty('time')
    expectTypeOf<MediaPreviewProviderRequest>().not.toHaveProperty('source')
    expectTypeOf<MediaPreviewProviderRequest>().not.toHaveProperty('media')
    expectTypeOf<MediaPreviewProviderRequest>().not.toHaveProperty('frame')
    expectTypeOf<MediaPreviewProviderResult>().toHaveProperty('blob')
    expectTypeOf<MediaPreviewImage>().toHaveProperty('sessionEpoch')
    expectTypeOf<MediaPreviewProvider>().returns.toEqualTypeOf<Promise<MediaPreviewProviderResult | null>>()
    expectTypeOf<MediaPreviewOptions>().toHaveProperty('provider')
    expectTypeOf<MXPlayerOptions['preview']>().toEqualTypeOf<MediaPreviewOptions | undefined>()
    expectTypeOf<MediaEngine['requestPreview']>().returns.toEqualTypeOf<Promise<MediaPreviewImage | null>>()
    expect(ErrorCodes.PREVIEW_INPUT_INVALID).toBe('PREVIEW_INPUT_INVALID')
  })
})
