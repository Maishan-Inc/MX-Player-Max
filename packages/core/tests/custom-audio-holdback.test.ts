import { describe, expect, it, vi } from 'vitest'
import { createCustomHarness, FakeAudioData, packet } from './custom-fakes'

function audioPacket(timestamp: number, duration = 10_000) {
  return packet(timestamp, { trackId: 2, kind: 'audio', duration, keyframe: true })
}

/**
 * The processor renders nothing while paused, and `startBufferDuration` on its own can fill the
 * MessagePort queue, so the block that arrived before the first `consumed` ack used to hit the
 * hard `AUDIO_BUFFER_OVERFLOW` inside `enqueue` and kill the session. Decoded PCM the transport
 * has no room for is held by the controller instead, counted as buffered, and handed over as
 * soon as the processor acknowledges a block.
 */
describe('CustomMediaPipeline audio holdback', () => {
  it('holds decoded PCM the transport cannot take, then hands it over on acknowledgement', async () => {
    const harness = createCustomHarness({
      audio: true,
      customAudio: { maxMessagePortPendingBlocks: 1 },
      responses: [{ packets: [audioPacket(0)], endOfStream: false }],
    })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    const output = harness.audioOutput()
    const decoder = harness.audioDecoder()
    if (!output || !decoder) throw new Error('missing audio fakes')
    await vi.waitFor(() => expect(output.blocks).toHaveLength(1))

    decoder.emitData(new FakeAudioData({ timestamp: 10_000, frames: 480 }), 0)

    // Transport holds one block, the controller holds the other. Nothing dropped, no error.
    expect(output.blocks).toHaveLength(1)
    expect(harness.pipeline.audioStats).toMatchObject({ decodedBlocks: 2, bufferedFrames: 960, overflows: 0 })
    expect(harness.events.filter((event) => event.type === 'error')).toHaveLength(0)

    output.consume(480, 0)
    await vi.waitFor(() => expect(harness.pipeline.audioStats?.bufferedFrames).toBe(480))
    expect(output.blocks).toHaveLength(1)
    expect(harness.pipeline.audioStats?.decodedBlocks).toBe(2)
    harness.pipeline.close()
  })

  it('reports overflow only once held blocks outrun the decoder queue budget', async () => {
    const harness = createCustomHarness({
      audio: true,
      customAudio: { maxMessagePortPendingBlocks: 1, maxDecodeQueueSize: 1 },
      responses: [{ packets: [audioPacket(0)], endOfStream: false }],
    })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    const output = harness.audioOutput()
    const decoder = harness.audioDecoder()
    if (!output || !decoder) throw new Error('missing audio fakes')
    await vi.waitFor(() => expect(output.blocks).toHaveLength(1))

    // One held block is within budget; a second one means the feed never honoured high water.
    decoder.emitData(new FakeAudioData({ timestamp: 10_000, frames: 480 }), 0)
    expect(harness.pipeline.audioStats?.overflows).toBe(0)
    decoder.emitData(new FakeAudioData({ timestamp: 20_000, frames: 480 }), 0)
    await vi.waitFor(() => expect(harness.pipeline.audioStats?.overflows).toBe(1))
    harness.pipeline.close()
  })
})
