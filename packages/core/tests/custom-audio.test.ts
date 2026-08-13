import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { createCustomHarness, FakeAudioData, packet } from './custom-fakes'

function audioPacket(timestamp: number, duration = 10_000) {
  return packet(timestamp, { trackId: 2, kind: 'audio', duration, keyframe: true })
}

describe('CustomMediaPipeline audio integration', () => {
  it('starts the video-only wall clock from the first decoded frame', async () => {
    const harness = createCustomHarness({
      customVideo: { maxDecodeQueueSize: 1 },
      responses: [{ packets: [packet(250_000, { keyframe: true })], endOfStream: false }],
    })
    await harness.pipeline.initialize()
    harness.decoder().autoOutput = false
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.decoder().decoded).toHaveLength(1))
    expect(harness.pipeline.audioClock).toMatchObject({ source: 'wall-clock', running: false, mediaTime: 0, epoch: 0 })
    expect(harness.events.some((event) => event.type === 'playing')).toBe(false)

    harness.decoder().emitFrame(250_000, 33_333, 0)
    expect(harness.pipeline.audioClock).toMatchObject({ source: 'wall-clock', running: true, epoch: 0 })
    expect(harness.pipeline.audioClock.mediaTime).toBeGreaterThanOrEqual(250_000)
    expect(harness.events.filter((event) => event.type === 'playing')).toHaveLength(1)
    const frame = await harness.pipeline.readVideoFrame()
    frame?.frame.close()
    harness.pipeline.close()
  })

  it('routes audio and video packets from one Demux session and observes startup buffering', async () => {
    const harness = createCustomHarness({
      audio: true,
      customAudio: { startBufferDuration: 10_000 },
      responses: [{ packets: [audioPacket(0), packet(0)], endOfStream: false }],
    })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.audioDecoder()?.decoded).toHaveLength(1))
    expect(harness.decoder().decoded).toHaveLength(1)
    expect(harness.audioOutput()?.play).toHaveBeenCalledWith(0)
    expect(harness.demux.start).toHaveBeenCalledOnce()
    expect(harness.pipeline.audioStats).toMatchObject({ decodedBlocks: 1, bufferedFrames: 480, outputState: 'running' })
    const frame = await harness.pipeline.readVideoFrame()
    frame?.frame.close()
    harness.pipeline.close()
  })

  it('includes the AudioDecoder queue in Demux backpressure', async () => {
    const harness = createCustomHarness({
      audio: true,
      customAudio: { maxDecodeQueueSize: 1 },
      responses: [
        { packets: [audioPacket(0)], endOfStream: false },
        { packets: [audioPacket(10_000)], endOfStream: false },
      ],
    })
    await harness.pipeline.initialize()
    const decoder = harness.audioDecoder()
    if (!decoder) throw new Error('missing fake audio decoder')
    decoder.autoOutput = false
    await harness.pipeline.play()
    await vi.waitFor(() => expect(decoder.decodeQueueSize).toBe(1))
    expect(harness.demux.read).toHaveBeenCalledOnce()
    decoder.dequeue()
    await vi.waitFor(() => expect(harness.demux.read).toHaveBeenCalledTimes(2))
    harness.pipeline.close()
  })

  it('rolls back a blocked play request and applies rate, volume and mute to the output graph', async () => {
    const harness = createCustomHarness({ audio: true })
    await harness.pipeline.initialize()
    const output = harness.audioOutput()
    if (!output) throw new Error('missing fake audio output')
    output.resumeError = { code: ErrorCodes.AUDIO_AUTOPLAY_BLOCKED, message: 'blocked', recoverable: true }
    await expect(harness.pipeline.play()).rejects.toMatchObject({ code: ErrorCodes.AUDIO_AUTOPLAY_BLOCKED })
    output.resumeError = null
    await harness.pipeline.play()
    harness.pipeline.setPlaybackRate(1.5)
    harness.pipeline.setVolume(0.25)
    harness.pipeline.setMuted(true)
    harness.pipeline.pause()
    expect(output.setPlaybackRate).toHaveBeenCalledWith(1.5, 0)
    expect(output.setVolume).toHaveBeenCalledWith(0.25)
    expect(output.setMuted).toHaveBeenCalledWith(true)
    expect(output.pause).toHaveBeenCalledWith(0)
    harness.pipeline.close()
  })

  it('advances the media clock only from consumed samples and preserves underrun state', async () => {
    const harness = createCustomHarness({
      audio: true,
      customAudio: { startBufferDuration: 0 },
      responses: [{ packets: [audioPacket(0), packet(0)], endOfStream: false }],
    })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    const output = harness.audioOutput()
    if (!output) throw new Error('missing fake audio output')
    await vi.waitFor(() => expect(output.bufferedFrames).toBe(480))
    expect(harness.pipeline.audioClock.mediaTime).toBe(0)
    output.consume(240)
    expect(harness.pipeline.audioClock.mediaTime).toBe(5_000)
    output.underrun()
    expect(harness.pipeline.audioClock).toMatchObject({ mediaTime: 5_000, underrun: true, source: 'audio-context' })
    expect(harness.events.filter((event) => event.type === 'audiounderrun')).toHaveLength(1)
    harness.pipeline.close()
  })

  it('sample-crops crossing seek audio and closes stale epoch AudioData', async () => {
    const harness = createCustomHarness({
      audio: true,
      responses: [{ packets: [audioPacket(10_000), packet(15_000, { keyframe: true })], endOfStream: false }],
    })
    await harness.pipeline.initialize()
    await harness.pipeline.seek(15_000)
    const output = harness.audioOutput()
    const decoder = harness.audioDecoder()
    if (!output || !decoder) throw new Error('missing fake audio path')
    expect(output.blocks[0]).toMatchObject({ timestamp: 15_000, frames: 240, epoch: 1 })
    expect(harness.pipeline.audioStats?.droppedPreSeekFrames).toBe(240)
    const stale = new FakeAudioData({ timestamp: 0 })
    decoder.emitData(stale, 0)
    expect(stale.close).toHaveBeenCalledOnce()
    const frame = await harness.pipeline.readVideoFrame()
    frame?.frame.close()
    harness.pipeline.close()
  })

  it('flushes both decoders and emits ended only after video and PCM drain', async () => {
    const harness = createCustomHarness({
      audio: true,
      customAudio: { startBufferDuration: 0 },
      responses: [{ packets: [audioPacket(0), packet(0)], endOfStream: true }],
    })
    await harness.pipeline.initialize()
    await harness.pipeline.play()
    await vi.waitFor(() => expect(harness.pipeline.stats.endOfStream).toBe(true))
    expect(harness.decoder().flush).toHaveBeenCalledOnce()
    expect(harness.audioDecoder()?.flush).toHaveBeenCalledOnce()
    const frame = await harness.pipeline.readVideoFrame()
    expect(harness.events.filter((event) => event.type === 'ended')).toHaveLength(0)
    harness.audioOutput()?.consume()
    await vi.waitFor(() => expect(harness.events.filter((event) => event.type === 'ended')).toHaveLength(1))
    expect(await harness.pipeline.readVideoFrame()).toBeNull()
    frame?.frame.close()
    harness.pipeline.close()
  })

  it('closes audio resources and releases late AudioData without event leakage', async () => {
    const harness = createCustomHarness({ audio: true })
    await harness.pipeline.initialize()
    const decoder = harness.audioDecoder()
    const output = harness.audioOutput()
    if (!decoder || !output) throw new Error('missing fake audio path')
    harness.pipeline.close()
    const eventCount = harness.events.length
    const late = new FakeAudioData({ timestamp: 0 })
    decoder.emitData(late, 0)
    expect(decoder.close).toHaveBeenCalledOnce()
    expect(output.close).toHaveBeenCalledOnce()
    expect(late.close).toHaveBeenCalledOnce()
    expect(harness.events).toHaveLength(eventCount)
  })
})
