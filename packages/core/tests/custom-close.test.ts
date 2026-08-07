import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { createCustomHarness, packet } from './custom-fakes'

describe('CustomMediaPipeline close', () => {
  it('closes queued frames, Worker and decoder, and rejects pending readers', async () => {
    const harness = createCustomHarness({ responses: [{ packets: [packet(0)], endOfStream: false }] })
    harness.demux.read
      .mockImplementationOnce(async (epoch) => ({ type: 'packets', sessionId: 'fake', epoch, requestId: 'first', packets: [packet(0)], endOfStream: false }))
      .mockImplementationOnce(async () => new Promise(() => {}))
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.pipeline.stats.queuedFrames).toBe(1))
    const waiting = harness.pipeline.readVideoFrame()
    const delivered = await waiting
    const pending = harness.pipeline.readVideoFrame()
    harness.pipeline.close()
    await expect(pending).rejects.toMatchObject({ code: ErrorCodes.ENGINE_CLOSED })
    expect(harness.demux.close).toHaveBeenCalledOnce()
    expect(harness.decoder().close).toHaveBeenCalledOnce()
    expect(delivered?.frame).toBeDefined()
    delivered?.frame.close()
  })

  it('does not close a delivered frame when closing the pipeline', async () => {
    const harness = createCustomHarness({ responses: [{ packets: [packet(0)], endOfStream: false }] })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    const delivered = await harness.pipeline.readVideoFrame()
    const close = (delivered?.frame as unknown as { close: ReturnType<typeof vi.fn> }).close
    harness.pipeline.close()
    expect(close).not.toHaveBeenCalled()
    delivered?.frame.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes late frames and makes close idempotent', async () => {
    const harness = createCustomHarness()
    await harness.pipeline.initialize()
    const decoder = harness.decoder()
    harness.pipeline.close()
    harness.pipeline.close()
    const late = decoder.emitFrame(0, null, 0)
    expect(late.close).toHaveBeenCalledOnce()
    expect(harness.demux.close).toHaveBeenCalledOnce()
    expect(decoder.close).toHaveBeenCalledOnce()
    await expect(harness.pipeline.readVideoFrame()).rejects.toMatchObject({ code: ErrorCodes.ENGINE_CLOSED })
  })

  it('clears a pending decoder operation timeout on close', async () => {
    vi.useFakeTimers()
    const harness = createCustomHarness({ responses: [{ packets: [], endOfStream: true }] })
    await harness.pipeline.initialize()
    harness.decoder().flush.mockImplementationOnce(async () => new Promise<void>(() => {}))
    await harness.pipeline.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.decoder().flush).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    harness.pipeline.close()
    expect(vi.getTimerCount()).toBe(0)
  })
})

afterEach(() => vi.useRealTimers())
