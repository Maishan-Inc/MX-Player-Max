import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { resolveCustomVideoOptions, VideoFrameQueue } from '../src/index'
import { fakeFrame } from './custom-fakes'

describe('VideoFrameQueue', () => {
  it('delivers stable PTS/FIFO order and transfers ownership on shift', () => {
    const queue = new VideoFrameQueue(resolveCustomVideoOptions())
    const later = fakeFrame(20)
    const firstAtTen = fakeFrame(10)
    const secondAtTen = fakeFrame(10)
    queue.push({ frame: later.frame, timestamp: 20, duration: 5, epoch: 0 })
    queue.push({ frame: firstAtTen.frame, timestamp: 10, duration: 5, epoch: 0 })
    queue.push({ frame: secondAtTen.frame, timestamp: 10, duration: 5, epoch: 0 })
    expect(queue.shift()?.frame).toBe(firstAtTen.frame)
    expect(queue.shift()?.frame).toBe(secondAtTen.frame)
    expect(queue.shift()?.frame).toBe(later.frame)
    expect(firstAtTen.close).not.toHaveBeenCalled()
  })

  it('closes every unconsumed frame on clear but never closes delivered frames', () => {
    const queue = new VideoFrameQueue(resolveCustomVideoOptions())
    const delivered = fakeFrame(0)
    const owned = fakeFrame(1)
    queue.push({ frame: delivered.frame, timestamp: 0, duration: 1, epoch: 0 })
    queue.push({ frame: owned.frame, timestamp: 1, duration: 1, epoch: 0 })
    queue.shift()
    expect(queue.clear()).toBe(1)
    expect(delivered.close).not.toHaveBeenCalled()
    expect(owned.close).toHaveBeenCalledOnce()
  })

  it('enforces frame count and buffered duration with a stable overflow error', () => {
    const byCount = new VideoFrameQueue(resolveCustomVideoOptions({ maxDecodedFrames: 1, lowWaterMark: 0 }))
    byCount.push({ frame: fakeFrame(0).frame, timestamp: 0, duration: 1, epoch: 0 })
    const overflow = fakeFrame(1)
    expect(() => byCount.push({ frame: overflow.frame, timestamp: 1, duration: 1, epoch: 0 })).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_QUEUE_OVERFLOW }))
    expect(overflow.close).toHaveBeenCalledOnce()

    const byDuration = new VideoFrameQueue(resolveCustomVideoOptions({ maxBufferedDuration: 10 }))
    byDuration.push({ frame: fakeFrame(0).frame, timestamp: 0, duration: 10, epoch: 0 })
    expect(byDuration.canAccept(1)).toBe(false)
  })

  it.each([
    { maxDecodedFrames: 0 },
    { maxDecodedFrames: 2, lowWaterMark: 2 },
    { maxDecodeQueueSize: 1000 },
    { maxBufferedDuration: Number.POSITIVE_INFINITY },
    { operationTimeoutMs: 0 },
  ])('rejects invalid bounded queue options %#', (options) => {
    expect(() => resolveCustomVideoOptions(options)).toThrowError(expect.objectContaining({ code: ErrorCodes.CUSTOM_INVALID_QUEUE_CONFIG }))
  })

  it('rejects duplicate and invalid frames without duplicate delivery', () => {
    const queue = new VideoFrameQueue(resolveCustomVideoOptions())
    const record = fakeFrame(0)
    queue.push({ frame: record.frame, timestamp: 0, duration: 1, epoch: 0 })
    expect(() => queue.push({ frame: record.frame, timestamp: 0, duration: 1, epoch: 0 })).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_FRAME_INVALID }))
    const invalidClose = vi.fn()
    expect(() => queue.push({ frame: { close: invalidClose } as unknown as VideoFrame, timestamp: Number.NaN, duration: null, epoch: 0 })).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_FRAME_INVALID }))
    expect(invalidClose).toHaveBeenCalledOnce()
  })
})
