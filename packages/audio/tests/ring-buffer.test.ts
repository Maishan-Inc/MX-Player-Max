import { describe, expect, it } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { PcmRingBuffer, SharedPcmRingBuffer, SHARED_AVAILABLE_FRAMES } from '../src/index'

describe('PCM ring buffers', () => {
  it('wraps reads/writes without duplicate consumption', () => {
    const ring = new PcmRingBuffer(4, 1)
    ring.write(Float32Array.of(1, 2, 3))
    const first = new Float32Array(2)
    expect(ring.read(first)).toEqual({ readFrames: 2, silentFrames: 0 })
    ring.write(Float32Array.of(4, 5, 6))
    const second = new Float32Array(4)
    ring.read(second)
    expect([...first, ...second]).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('throws stable overflow and zero-fills underrun', () => {
    const ring = new PcmRingBuffer(2, 2)
    ring.write(Float32Array.of(1, 10, 2, 20))
    expect(() => ring.write(Float32Array.of(3, 30))).toThrowError(expect.objectContaining({ code: ErrorCodes.AUDIO_BUFFER_OVERFLOW }))
    const output = new Float32Array(6)
    expect(ring.read(output)).toEqual({ readFrames: 2, silentFrames: 1 })
    expect([...output]).toEqual([1, 10, 2, 20, 0, 0])
    expect(ring.underruns).toBe(1)
  })

  it('uses fixed SharedArrayBuffer storage only when explicitly constructed', () => {
    const ring = new SharedPcmRingBuffer(4, 1)
    ring.write(Float32Array.of(1, 2), 3)
    const header = new Int32Array(ring.descriptor.header)
    expect(Atomics.load(header, SHARED_AVAILABLE_FRAMES)).toBe(2)
    ring.reset(4)
    expect(ring.availableFrames).toBe(0)
    ring.close()
    expect(() => ring.write(Float32Array.of(3), 4)).toThrowError(expect.objectContaining({ code: ErrorCodes.AUDIO_OPERATION_FAILED }))
  })
})
