import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { createCustomHarness, packet } from './custom-fakes'

describe('CustomMediaPipeline end of stream', () => {
  it('flushes after Demux EOS, keeps flush output, and returns null only after drain', async () => {
    const harness = createCustomHarness({ responses: [
      { packets: [packet(0)], endOfStream: false },
      { packets: [], endOfStream: true },
    ] })
    await harness.pipeline.initialize()
    const decoder = harness.decoder()
    decoder.flush.mockImplementationOnce(async (epoch) => { decoder.emitFrame(33_333, 33_333, epoch) })
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.pipeline.stats.endOfStream).toBe(true))
    expect(decoder.flush).toHaveBeenCalledOnce()
    const first = await harness.pipeline.readVideoFrame()
    const second = await harness.pipeline.readVideoFrame()
    expect([first?.timestamp, second?.timestamp]).toEqual([0, 33_333])
    expect(await harness.pipeline.readVideoFrame()).toBeNull()
    expect(harness.events.filter((event) => event.type === 'ended')).toHaveLength(1)
    first?.frame.close()
    second?.frame.close()
    harness.pipeline.close()
  })

  it('maps flush failure and emits one stable error', async () => {
    const harness = createCustomHarness({ responses: [{ packets: [], endOfStream: true }] })
    await harness.pipeline.initialize()
    harness.decoder().flushError = new Error('private flush detail')
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.events.some((event) => event.type === 'error')).toBe(true))
    const error = harness.events.find((event) => event.type === 'error')
    expect(error).toMatchObject({ type: 'error', error: { code: ErrorCodes.WEBCODECS_FLUSH_FAILED } })
  })

  it('resolves all waiting readers at EOS without unbounded polling', async () => {
    const harness = createCustomHarness({ responses: [{ packets: [], endOfStream: true }] })
    await harness.pipeline.initialize()
    const first = harness.pipeline.readVideoFrame()
    const second = harness.pipeline.readVideoFrame()
    await harness.pipeline.play()
    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toBeNull()
    harness.pipeline.close()
  })
})
