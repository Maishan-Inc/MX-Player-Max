import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { createCustomHarness, packet } from './custom-fakes'

describe('CustomMediaPipeline seek and epoch', () => {
  it('resets/reconfigures, starts from keyframe, drops preroll and exposes the target frame', async () => {
    const harness = createCustomHarness({ responses: [{ packets: [
      packet(0, { keyframe: false }),
      packet(50, { keyframe: true }),
      packet(90, { keyframe: false }),
      packet(100, { keyframe: false }),
    ], endOfStream: false }] })
    await harness.pipeline.initialize()
    await harness.pipeline.seek(100)
    expect(harness.demux.seek).toHaveBeenCalledWith(1, 100)
    expect(harness.decoder().reset).toHaveBeenCalledWith(1)
    expect(harness.decoder().configure).toHaveBeenCalledTimes(2)
    expect(harness.decoder().decoded[0]?.packet.keyframe).toBe(true)
    expect(harness.pipeline.stats.droppedPreSeekFrames).toBe(2)
    const frame = await harness.pipeline.readVideoFrame()
    expect(frame).toMatchObject({ timestamp: 100, epoch: 1 })
    frame?.frame.close()
    harness.pipeline.close()
  })

  it('allows only the final consecutive seek epoch to complete', async () => {
    const harness = createCustomHarness({ responses: [{ packets: [packet(200, { keyframe: true })], endOfStream: false }] })
    await harness.pipeline.initialize()
    let rejectFirst!: (reason: unknown) => void
    harness.demux.seek.mockImplementationOnce(async () => new Promise<void>((_resolve, reject) => { rejectFirst = reject }))
    harness.demux.advanceEpoch.mockImplementation((epoch) => {
      harness.demux.epoch = epoch
      if (epoch === 2) rejectFirst({ code: ErrorCodes.WEBCODECS_ABORTED, message: 'superseded', recoverable: true })
    })
    const first = harness.pipeline.seek(100)
    await vi.waitFor(() => expect(harness.demux.seek).toHaveBeenCalledTimes(1))
    const second = harness.pipeline.seek(200)
    await expect(first).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_ABORTED })
    await second
    const frame = await harness.pipeline.readVideoFrame()
    expect(frame).toMatchObject({ timestamp: 200, epoch: 2 })
    frame?.frame.close()
    harness.pipeline.close()
  })

  it('closes old epoch frames and ignores old decoder errors', async () => {
    const harness = createCustomHarness({ responses: [{ packets: [packet(100, { keyframe: true })], endOfStream: false }] })
    await harness.pipeline.initialize()
    await harness.pipeline.seek(100)
    const stale = harness.decoder().emitFrame(0, 10, 0)
    harness.decoder().emitError({ code: ErrorCodes.WEBCODECS_DECODE_FAILED, message: 'old', recoverable: false }, 0)
    expect(stale.close).toHaveBeenCalledOnce()
    expect(harness.events.filter((event) => event.type === 'error')).toHaveLength(0)
    harness.pipeline.close()
  })

  it('rejects pending readers from the previous epoch', async () => {
    const harness = createCustomHarness({ responses: [{ packets: [packet(100, { keyframe: true })], endOfStream: false }] })
    await harness.pipeline.initialize()
    const reader = harness.pipeline.readVideoFrame()
    const seek = harness.pipeline.seek(100)
    await expect(reader).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_ABORTED })
    await seek
    harness.pipeline.close()
  })
})
