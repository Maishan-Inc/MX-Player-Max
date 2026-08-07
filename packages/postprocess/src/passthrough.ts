import type { Micros } from '@mx-player-max/types'
import type { DecodedFrameSource, FrameSource, PipelineFrame } from './types'

/**
 * Identity frame source — used when AI post-processing is disabled or has
 * been degraded to `off`. Returns the decoded frame nearest to the clock
 * time with no transformation.
 *
 * This is the reference implementation of the pull-based contract: it
 * proves the architecture end-to-end without any GPU work, and is the
 * fallback every AI failure path degrades into.
 */
export function createPassthroughSource(upstream: DecodedFrameSource): FrameSource {
  let currentEpoch = upstream.epoch
  let closed = false
  let lastFrame: PipelineFrame | null = null

  return {
    /* No lookahead: passthrough needs only the frame at the current time. */
    lookaheadFrames: 0,

    async frameAt(t: Micros, epoch: number): Promise<PipelineFrame | null> {
      if (closed) return null
      /* Stale epoch — a seek happened after this call was scheduled. */
      if (epoch !== currentEpoch) return null

      const frame = upstream.peekAt(t)
      if (frame) {
        lastFrame = frame
        return frame
      }

      /* Past the last frame with EOS: hold the final frame rather than
         returning null, which the presentation loop would read as buffer
         starvation and spin on. */
      if (upstream.endOfStream && lastFrame) return lastFrame

      return null
    },

    reset(epoch: number): void {
      currentEpoch = epoch
      lastFrame = null
    },

    close(): void {
      closed = true
      lastFrame = null
    },
  }
}
