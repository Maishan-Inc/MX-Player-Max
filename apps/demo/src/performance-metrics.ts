import type { PlaybackSnapshot, VideoPresentationSample } from '@mx-player-max/types'

/** Constant-space observations; submission drift is deliberately separate from physical A/V drift. */
export class PlaybackPerformanceTracker {
  activeDurationMs = 0
  minBufferedAheadMicros: number | null = null
  maxSubmissionDriftMicros: number | null = null
  submissionSamples = 0
  #previous: { at: number; playing: boolean } | null = null

  observePlayback(snapshot: Pick<PlaybackSnapshot, 'state' | 'buffering' | 'bufferedAhead'>, at: number): void {
    const playing = snapshot.state === 'playing' && !snapshot.buffering
    if (playing && this.#previous?.playing) this.activeDurationMs += Math.max(0, at - this.#previous.at)
    if (playing && Number.isFinite(snapshot.bufferedAhead)) {
      this.minBufferedAheadMicros = Math.min(this.minBufferedAheadMicros ?? Infinity, snapshot.bufferedAhead)
    }
    this.#previous = { at, playing }
  }

  observePresentation(sample: VideoPresentationSample): void {
    if (sample.clockSource !== 'audio-context') return
    this.submissionSamples += 1
    this.maxSubmissionDriftMicros = Math.max(this.maxSubmissionDriftMicros ?? 0, Math.abs(sample.driftMicros))
  }
}
