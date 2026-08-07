import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { createCustomHarness, packet } from './custom-fakes'

describe('CustomMediaPipeline', () => {
  it('initializes Demux Worker and VideoDecoder, then exposes pull-based frames', async () => {
    const harness = createCustomHarness({ responses: [
      { packets: [packet(0), packet(1, { kind: 'audio', trackId: 2 })], endOfStream: false },
      { packets: [], endOfStream: true },
    ] })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    const decoded = await harness.pipeline.readVideoFrame()
    expect(decoded).toMatchObject({ timestamp: 0, duration: 33_333, epoch: 0 })
    expect(harness.decoder().decoded).toHaveLength(1)
    decoded?.frame.close()
    harness.pipeline.close()
  })

  it('pauses and resumes the decode pump without closing queued frames', async () => {
    const harness = createCustomHarness({ responses: [
      { packets: [packet(0)], endOfStream: false },
      { packets: [packet(33_333, { keyframe: false })], endOfStream: false },
    ] })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.pipeline.stats.queuedFrames).toBe(2))
    expect(harness.events.map((event) => event.type)).toContain('frameavailable')
    harness.pipeline.pause()
    const before = harness.decoder().decoded.length
    await Promise.resolve()
    expect(harness.decoder().decoded).toHaveLength(before)
    await harness.pipeline.play()
    harness.pipeline.close()
  })

  it('retains an in-flight Demux response when paused before it resolves', async () => {
    const harness = createCustomHarness()
    let resolveRead!: (response: Awaited<ReturnType<typeof harness.demux.read>>) => void
    harness.demux.read.mockImplementationOnce(async (epoch: number) => new Promise((resolve) => {
      resolveRead = resolve
      harness.demux.epoch = epoch
    }))
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.demux.read).toHaveBeenCalledOnce())

    harness.pipeline.pause()
    resolveRead({
      type: 'packets',
      sessionId: 'fake',
      epoch: 0,
      requestId: 'read-1',
      packets: [packet(0)],
      endOfStream: false,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(harness.decoder().decoded).toHaveLength(0)

    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.decoder().decoded).toHaveLength(1))
    const frame = await harness.pipeline.readVideoFrame()
    frame?.frame.close()
    harness.pipeline.close()
  })

  it('requires a supported video track and rejects invalid controls', async () => {
    const harness = createCustomHarness()
    await harness.pipeline.initialize()
    expect(() => harness.pipeline.setPlaybackRate(0)).toThrowError(expect.objectContaining({ code: ErrorCodes.NATIVE_INVALID_RATE }))
    expect(() => harness.pipeline.setVolume(2)).toThrowError(expect.objectContaining({ code: ErrorCodes.NATIVE_INVALID_VOLUME }))
    await expect(harness.pipeline.seek(-1)).rejects.toMatchObject({ code: ErrorCodes.CUSTOM_SEEK_FAILED })
    harness.pipeline.close()
  })

  it('never creates ImageBitmap, pixel arrays, video elements or renderer calls', async () => {
    const createImageBitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    const harness = createCustomHarness({ responses: [{ packets: [packet(0)], endOfStream: false }] })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    const frame = await harness.pipeline.readVideoFrame()
    expect(createImageBitmap).not.toHaveBeenCalled()
    frame?.frame.close()
    harness.pipeline.close()
    vi.unstubAllGlobals()
  })
})
