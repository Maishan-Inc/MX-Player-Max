import { describe, expect, it } from 'vitest'
import { PlaybackPerformanceTracker } from './performance-metrics'

describe('performance observations', () => {
  it('counts active playback only and does not sample the EOF tail as zero forward buffer', () => {
    const tracker = new PlaybackPerformanceTracker()
    const playing = { state: 'playing', buffering: false, bufferedAhead: 200_000 } as const
    tracker.observePlayback(playing, 0)
    tracker.observePlayback(playing, 500)
    tracker.observePlayback({ ...playing, buffering: true }, 1000)
    tracker.observePlayback(playing, 1500)
    tracker.observePlayback(playing, 2000)
    tracker.observePlayback({ state: 'ended', buffering: false, bufferedAhead: 0 }, 2500)
    tracker.observePlayback({ state: 'ended', buffering: false, bufferedAhead: 0 }, 30_000)
    expect(tracker.activeDurationMs).toBe(1000)
    expect(tracker.minBufferedAheadMicros).toBe(200_000)
  })

  it('keeps the worst signed submission error by magnitude and ignores wall-clock video', () => {
    const tracker = new PlaybackPerformanceTracker()
    const sample = { epoch: 1, timestamp: 0, mediaTime: 0, driftMicros: -12_000, clockSource: 'audio-context' } as const
    tracker.observePresentation(sample)
    tracker.observePresentation({ ...sample, driftMicros: 6000 })
    tracker.observePresentation({ ...sample, driftMicros: 99_000, clockSource: 'wall-clock' })
    expect(tracker.maxSubmissionDriftMicros).toBe(12_000)
    expect(tracker.submissionSamples).toBe(2)
  })
})
