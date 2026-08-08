import { describe, expect, it } from 'vitest'
import { StreamingLinearResampler } from '../src/index'

describe('StreamingLinearResampler', () => {
  it('preserves fractional phase across block boundaries', () => {
    const source = Float32Array.from({ length: 48 }, (_, index) => index / 48)
    const whole = new StreamingLinearResampler(48_000, 44_100, 1).process(source)
    const split = new StreamingLinearResampler(48_000, 44_100, 1)
    const joined = new Float32Array([...split.process(source.subarray(0, 17)), ...split.process(source.subarray(17))])
    expect(joined.length).toBe(whole.length)
    for (let index = 0; index < whole.length; index += 1) expect(joined[index]).toBeCloseTo(whole[index] ?? 0, 6)
  })

  it('keeps long-run output sample error bounded', () => {
    const resampler = new StreamingLinearResampler(48_000, 44_100, 2)
    let frames = 0
    for (let block = 0; block < 100; block += 1) frames += resampler.process(new Float32Array(480 * 2)).length / 2
    expect(Math.abs(frames - 44_100)).toBeLessThanOrEqual(1)
  })

  it('passes equal-rate PCM without sharing the caller buffer', () => {
    const input = Float32Array.of(1, 2, 3, 4)
    const output = new StreamingLinearResampler(48_000, 48_000, 2).process(input)
    expect(output).toEqual(input)
    expect(output).not.toBe(input)
  })
})
