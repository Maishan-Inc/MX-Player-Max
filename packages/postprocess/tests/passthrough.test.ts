import { describe, expect, it } from 'vitest'
import { createPassthroughSource } from '../src/passthrough'
import type { DecodedFrameSource, PipelineFrame } from '../src/types'

function gpuFrame(timestamp: number): PipelineFrame {
  return {
    location: 'gpu',
    texture: {} as GPUTexture,
    width: 1920,
    height: 1080,
    timestamp,
    release: () => {},
  }
}

/** Minimal in-memory frame queue standing in for the phase-4 implementation. */
function createStubQueue(frames: PipelineFrame[], options: { endOfStream?: boolean; epoch?: number } = {}): DecodedFrameSource {
  return {
    peekAt(t) {
      /* Return the last frame whose timestamp is <= t. */
      let match: PipelineFrame | null = null
      for (const frame of frames) {
        if (frame.timestamp <= t) match = frame
        else break
      }
      return match
    },
    peekNext(timestamp) {
      return frames.find((frame) => frame.timestamp > timestamp) ?? null
    },
    endOfStream: options.endOfStream ?? false,
    epoch: options.epoch ?? 0,
  }
}

describe('createPassthroughSource', () => {
  it('returns the nearest frame at or before the clock time', async () => {
    const frames = [gpuFrame(0), gpuFrame(41_667), gpuFrame(83_333)]
    const source = createPassthroughSource(createStubQueue(frames))

    expect(await source.frameAt(0, 0)).toBe(frames[0])
    expect(await source.frameAt(50_000, 0)).toBe(frames[1])
    expect(await source.frameAt(83_333, 0)).toBe(frames[2])
  })

  it('needs no lookahead', () => {
    const source = createPassthroughSource(createStubQueue([]))
    expect(source.lookaheadFrames).toBe(0)
  })

  it('resolves null for a stale epoch after reset', async () => {
    const frames = [gpuFrame(0)]
    const source = createPassthroughSource(createStubQueue(frames))

    expect(await source.frameAt(0, 0)).toBe(frames[0])

    source.reset(1)

    /* A call scheduled before the seek carries the old epoch and must be discarded. */
    expect(await source.frameAt(0, 0)).toBeNull()
    expect(await source.frameAt(0, 1)).toBe(frames[0])
  })

  it('holds the last frame past EOS instead of returning null', async () => {
    const frames = [gpuFrame(0), gpuFrame(41_667)]
    const source = createPassthroughSource(createStubQueue(frames, { endOfStream: true }))

    const last = await source.frameAt(41_667, 0)
    expect(last).toBe(frames[1])

    /* Past the final timestamp: hold, do not report starvation. */
    expect(await source.frameAt(999_999, 0)).toBe(frames[1])
  })

  it('returns null when starved and not at EOS', async () => {
    const source = createPassthroughSource(createStubQueue([], { endOfStream: false }))
    expect(await source.frameAt(1_000, 0)).toBeNull()
  })

  it('returns null after close', async () => {
    const frames = [gpuFrame(0)]
    const source = createPassthroughSource(createStubQueue(frames))
    source.close()
    expect(await source.frameAt(0, 0)).toBeNull()
  })
})
