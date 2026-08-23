import { describe, expect, it, vi } from 'vitest'
import { createCustomHarness, packet } from './custom-fakes'

describe('CustomMediaPipeline backpressure', () => {
  it('stops Demux reads at the high watermark and resumes at the low watermark', async () => {
    const responses = Array.from({ length: 6 }, (_, index) => ({
      packets: [packet(index * 10, { keyframe: index === 0, duration: 10 })], endOfStream: false,
    }))
    const harness = createCustomHarness({ responses, customVideo: { maxDecodedFrames: 3, lowWaterMark: 1, maxBufferedDuration: 100 } })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.pipeline.stats.queuedFrames).toBe(3))
    expect(harness.demux.read).toHaveBeenCalledTimes(3)
    const first = await harness.pipeline.readVideoFrame()
    await Promise.resolve()
    expect(harness.demux.read).toHaveBeenCalledTimes(3)
    const second = await harness.pipeline.readVideoFrame()
    await vi.waitFor(() => expect(harness.demux.read.mock.calls.length).toBeGreaterThan(3))
    first?.frame.close()
    second?.frame.close()
    harness.pipeline.close()
  })

  it('honors maxBufferedDuration and decoder decodeQueueSize', async () => {
    const harness = createCustomHarness({ responses: [
      { packets: [packet(0, { duration: 60 })], endOfStream: false },
      { packets: [packet(60, { keyframe: false, duration: 60 })], endOfStream: false },
    ], customVideo: { maxDecodedFrames: 8, lowWaterMark: 0, maxBufferedDuration: 60, maxDecodeQueueSize: 1 } })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.pipeline.stats.queuedFrames).toBe(1))
    expect(harness.demux.read).toHaveBeenCalledOnce()
    const frame = await harness.pipeline.readVideoFrame()
    await vi.waitFor(() => expect(harness.demux.read).toHaveBeenCalledTimes(2))
    frame?.frame.close()
    harness.pipeline.close()
  })

  it('bounds pending pull readers', async () => {
    const harness = createCustomHarness()
    await harness.pipeline.initialize()
    const readers = Array.from({ length: 64 }, () => harness.pipeline.readVideoFrame())
    await expect(harness.pipeline.readVideoFrame()).rejects.toMatchObject({ code: 'CUSTOM_OPERATION_FAILED' })
    harness.pipeline.close()
    await Promise.allSettled(readers)
  })

  it('waits for decoder dequeue before requesting more compressed packets', async () => {
    const harness = createCustomHarness({ responses: [
      { packets: [packet(0)], endOfStream: false },
      { packets: [packet(33_333, { keyframe: false })], endOfStream: false },
    ], customVideo: { maxDecodeQueueSize: 1 } })
    await harness.pipeline.initialize()
    harness.decoder().autoOutput = false
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.decoder().decodeQueueSize).toBe(1))
    expect(harness.demux.read).toHaveBeenCalledOnce()
    harness.decoder().dequeue()
    await vi.waitFor(() => expect(harness.demux.read).toHaveBeenCalledTimes(2))
    harness.pipeline.close()
  })

  it('keeps a lookahead frame queued for the interpolation stage', async () => {
    // lowWaterMark 0 lets the pump stop at a single queued frame once backpressure
    // has engaged. Interpolation needs `peekNext` to find a successor, so a
    // lookahead of 1 has to raise the mark or the AI chain returns null forever.
    const responses = Array.from({ length: 6 }, (_, index) => ({
      packets: [packet(index * 10, { keyframe: index === 0, duration: 10 })], endOfStream: false,
    }))
    const harness = createCustomHarness({ responses, customVideo: { maxDecodedFrames: 3, lowWaterMark: 0, maxBufferedDuration: 100 } })
    await harness.pipeline.initialize()
    expect(harness.pipeline.videoLookahead).toBe(0)
    harness.pipeline.setVideoLookahead(1)
    expect(harness.pipeline.videoLookahead).toBe(1)
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.pipeline.stats.queuedFrames).toBe(3))
    const drained = [await harness.pipeline.readVideoFrame(), await harness.pipeline.readVideoFrame()]
    await vi.waitFor(() => expect(harness.pipeline.stats.queuedFrames).toBeGreaterThanOrEqual(2))
    for (const frame of drained) frame?.frame.close()
    harness.pipeline.close()
  })

  it('refuses a lookahead the configured queue cannot hold', async () => {
    const harness = createCustomHarness({ customVideo: { maxDecodedFrames: 2, lowWaterMark: 0 } })
    await harness.pipeline.initialize()
    expect(() => harness.pipeline.setVideoLookahead(1)).toThrow(/maxDecodedFrames of at least 3/)
    expect(() => harness.pipeline.setVideoLookahead(-1)).toThrow(/integer in \[0, 8\]/)
    expect(harness.pipeline.videoLookahead).toBe(0)
    harness.pipeline.close()
  })

  it('turns an unsolicited normal-frame overflow into an error instead of silently dropping', async () => {
    const harness = createCustomHarness({ customVideo: { maxDecodedFrames: 1, lowWaterMark: 0 } })
    await harness.pipeline.initialize()
    const first = harness.decoder().emitFrame(0)
    const overflow = harness.decoder().emitFrame(1)
    expect(first.close).toHaveBeenCalledOnce()
    expect(overflow.close).toHaveBeenCalledOnce()
    expect(harness.events.find((event) => event.type === 'error')).toMatchObject({ type: 'error', error: { code: 'WEBCODECS_QUEUE_OVERFLOW' } })
  })
})
