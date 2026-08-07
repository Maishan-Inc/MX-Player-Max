import type { Micros } from '@mx-player-max/types'

/**
 * A single frame flowing through the post-processing pipeline.
 *
 * Frames may be either CPU-resident (VideoFrame) or GPU-resident (GPUTexture).
 * GPU frames carry a `release()` callback that must be called exactly once
 * by the consumer to return the texture to the pool.
 */
export type PipelineFrame =
  | {
      readonly location: 'cpu'
      readonly frame: VideoFrame
      readonly timestamp: Micros
    }
  | {
      readonly location: 'gpu'
      readonly texture: GPUTexture
      readonly width: number
      readonly height: number
      readonly timestamp: Micros
      /** Return the texture to the pool. Must be called exactly once. */
      readonly release: () => void
    }

/**
 * Pull-based frame source — the central abstraction.
 *
 * The presentation loop calls {@link frameAt} with the current audio-clock
 * time and epoch. The source decides whether to return a decoded frame, a
 * synthesised intermediate frame, or super-resolved frame.
 */
export interface FrameSource {
  /**
   * Return (or synthesise) the frame to display at time `t` in
   * microsecond units, or `null` if no frame is ready yet.
   *
   * A `null` return + `endOfStream` from the upstream source means playback
   * has ended; `null` without EOS means the queue is still buffering.
   */
  frameAt(t: Micros, epoch: number): Promise<PipelineFrame | null>

  /** Minimum number of frames the source needs buffered ahead of time. */
  readonly lookaheadFrames: number

  /** Discard cached state (seek). Texture pools are retained across resets. */
  reset(epoch: number): void

  /** Release all held resources. */
  close(): void
}

/**
 * A spatial 1-in-1-out stage (super-resolution, filters).
 */
export interface SpatialStage {
  readonly id: string
  /** Compute output dimensions for the given input size. */
  outputSize(width: number, height: number): { width: number; height: number }
  /** Process a single frame. Must check epoch before touching the renderer. */
  process(input: PipelineFrame, epoch: number): Promise<PipelineFrame>
  close(): void
}

/**
 * A temporal 2-in-1-out stage (frame interpolation).
 *
 * `synthesize(a, b, phase)` produces the frame at phase `p` between
 * frames A (p=0) and B (p=1). RIFE-style arbitrary-timestep synthesis
 * allows non-uniform phases for variable output frame rates.
 */
export interface TemporalStage {
  readonly id: string
  /**
   * @param phase 0 → frame A, 1 → frame B, 0.5 → midpoint.
   *        Arbitrary timesteps are supported (RIFE).
   */
  synthesize(a: PipelineFrame, b: PipelineFrame, phase: number, epoch: number): Promise<PipelineFrame>
  close(): void
}

/**
 * Decoded-frames, non-consuming source. Implemented by the phase-4 frame
 * queue. All peek methods are read-only — the postprocess chain never
 * owns frame lifetime.
 */
export interface DecodedFrameSource {
  /** Return the frame whose interval contains time `t`, or null. */
  peekAt(t: Micros): PipelineFrame | null
  /** Return the frame immediately following the given timestamp. */
  peekNext(timestamp: Micros): PipelineFrame | null
  readonly endOfStream: boolean
  readonly epoch: number
}
