import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { normalizeAudioData, PcmStreamProcessor, trimPcmBefore, type AudioDataLike } from '../src/index'

function fakeAudioData(options: { frames?: number; channels?: number; sampleRate?: number; timestamp?: number; duration?: number | null; planes?: number[][] } = {}) {
  const frames = options.frames ?? 4
  const channels = options.channels ?? 2
  const planes = options.planes ?? [[1, 2, 3, 4], [10, 20, 30, 40]]
  const close = vi.fn()
  const value: AudioDataLike = {
    numberOfFrames: frames, numberOfChannels: channels, sampleRate: options.sampleRate ?? 48_000,
    timestamp: options.timestamp ?? 0, duration: options.duration === undefined ? Math.round(frames * 1_000_000 / (options.sampleRate ?? 48_000)) : options.duration,
    copyTo(destination, copyOptions) { (destination as Float32Array).set(planes[copyOptions.planeIndex] ?? []) }, close,
  }
  return { value, close }
}

describe('AudioData PCM normalization', () => {
  it('copies planar AudioData to interleaved Float32 and closes ownership immediately', () => {
    const data = fakeAudioData()
    const block = normalizeAudioData(data.value, 3)
    expect([...block.data]).toEqual([1, 10, 2, 20, 3, 30, 4, 40])
    expect(block).toMatchObject({ frames: 4, channels: 2, sampleRate: 48_000, epoch: 3 })
    expect(data.close).toHaveBeenCalledOnce()
  })

  it('closes invalid AudioData and refuses unknown layouts or timing', () => {
    const multichannel = fakeAudioData({ channels: 6, planes: Array.from({ length: 6 }, () => [0, 0, 0, 0]) })
    expect(() => normalizeAudioData(multichannel.value, 0)).toThrowError(expect.objectContaining({ code: ErrorCodes.AUDIO_CHANNEL_LAYOUT_UNSUPPORTED }))
    expect(multichannel.close).toHaveBeenCalledOnce()
    const invalid = fakeAudioData({ timestamp: -1 })
    expect(() => normalizeAudioData(invalid.value, 0)).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_AUDIO_DATA_INVALID }))
    expect(invalid.close).toHaveBeenCalledOnce()
  })

  it('drops full preroll blocks and sample-crops a block crossing the seek target', () => {
    const data = fakeAudioData({ frames: 4, channels: 1, sampleRate: 1_000, timestamp: 10_000, duration: 4_000, planes: [[1, 2, 3, 4]] })
    const block = normalizeAudioData(data.value, 1)
    expect(trimPcmBefore(block, 14_000)).toBeNull()
    const cropped = trimPcmBefore(block, 12_000)
    expect(cropped?.timestamp).toBe(12_000)
    expect([...cropped!.data]).toEqual([3, 4])
  })

  it('keeps resampler state inside the stream processor and closes every AudioData', () => {
    const processor = new PcmStreamProcessor(24_000)
    const first = fakeAudioData({ frames: 4, channels: 1, sampleRate: 48_000, planes: [[0, 1, 2, 3]] })
    const second = fakeAudioData({ frames: 4, channels: 1, sampleRate: 48_000, timestamp: 83, planes: [[4, 5, 6, 7]] })
    expect(processor.process(first.value, 0)?.data.length).toBeGreaterThan(0)
    expect(processor.process(second.value, 0)?.data.length).toBeGreaterThan(0)
    expect(first.close).toHaveBeenCalledOnce()
    expect(second.close).toHaveBeenCalledOnce()
  })
})
