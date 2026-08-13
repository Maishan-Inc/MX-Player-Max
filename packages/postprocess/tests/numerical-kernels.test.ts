import { describe, expect, it } from 'vitest'
import {
  PACKED_CONVOLUTION_WGSL,
  PACKED_LAYER_NORM_WGSL,
  PACKED_PIXEL_SHUFFLE_X4_WGSL,
  PACKED_PIXEL_UNSHUFFLE_WGSL,
  RIFE_IFBLOCK_WGSL,
} from '../src/index'

describe('WGSL numerical contracts', () => {
  it('bilinearly warps and blends known temporal inputs', () => {
    const first = [0, 2, 4, 6]
    const second = [10, 12, 14, 16]
    const output = first.map((value, index) => value * 0.75 + (second[index] ?? 0) * 0.25)
    expect(output).toEqual([2.5, 4.5, 6.5, 8.5])

    const shifted = bilinear2x2(first, 0.75, 0.5)
    expect(shifted).toBeCloseTo(3.5, 6)
    expect(RIFE_IFBLOCK_WGSL).toContain('mix(wa, wb, alpha)')
  })

  it('computes a clamped 3x3 convolution with ReLU', () => {
    const input = [1, 2, 3, 4]
    const identity = [0, 0, 0, 0, 1, 0, 0, 0, 0]
    expect(convolve2x2(input, identity, -2)).toEqual([0, 0, 1, 2])
    const average = Array.from({ length: 9 }, () => 1 / 9)
    expect(convolve2x2(input, average, 0)).toEqual([
      2, 7 / 3, 8 / 3, 3,
    ].map((value) => expect.closeTo(value, 6)))
    expect(PACKED_CONVOLUTION_WGSL).toContain('params.inputChannels')
  })

  it('normalizes every packed channel using the full channel set', () => {
    const output = layerNorm([1, 2, 3, 4], [1, 1, 2, 0.5], [0, 1, 0, -1], 1e-5)
    expect(output).toEqual([
      expect.closeTo(-1.341635, 5),
      expect.closeTo(0.552788, 5),
      expect.closeTo(0.894423, 5),
      expect.closeTo(-0.329182, 5),
    ])
    expect(PACKED_LAYER_NORM_WGSL).toContain('second / f32(params.channels)')
  })

  it('round-trips pixel unshuffle and shuffle channel ordering', () => {
    const rgb = [
      1, 2, 3, 4, 5, 6,
      7, 8, 9, 10, 11, 12,
    ]
    const packed = pixelUnshuffle(rgb, 2, 2, 3, 2)
    expect(packed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(pixelShuffle(packed, 1, 1, 3, 2)).toEqual(rgb)
    expect(PACKED_PIXEL_UNSHUFFLE_WGSL).toContain('plane / params.scale')
    expect(PACKED_PIXEL_SHUFFLE_X4_WGSL).toContain('pixel + c')
  })
})

function bilinear2x2(input: readonly number[], x: number, y: number): number {
  const left = (input[0] ?? 0) * (1 - x) + (input[1] ?? 0) * x
  const right = (input[2] ?? 0) * (1 - x) + (input[3] ?? 0) * x
  return left * (1 - y) + right * y
}

function convolve2x2(input: readonly number[], weights: readonly number[], bias: number): number[] {
  const output: number[] = []
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      let value = bias
      for (let ky = 0; ky < 3; ky += 1) for (let kx = 0; kx < 3; kx += 1) {
        const sourceX = Math.min(1, Math.max(0, x + kx - 1))
        const sourceY = Math.min(1, Math.max(0, y + ky - 1))
        value += (input[sourceY * 2 + sourceX] ?? 0) * (weights[ky * 3 + kx] ?? 0)
      }
      output.push(Math.max(value, 0))
    }
  }
  return output
}

function layerNorm(input: readonly number[], scale: readonly number[], shift: readonly number[], epsilon: number): number[] {
  const mean = input.reduce((sum, value) => sum + value, 0) / input.length
  const variance = input.reduce((sum, value) => sum + value * value, 0) / input.length - mean * mean
  return input.map((value, index) => (value - mean) / Math.sqrt(variance + epsilon) * (scale[index] ?? 1) + (shift[index] ?? 0))
}

function pixelUnshuffle(input: readonly number[], width: number, height: number, channels: number, scale: number): number[] {
  const output: number[] = []
  for (let y = 0; y < height / scale; y += 1) for (let x = 0; x < width / scale; x += 1) {
    for (let plane = 0; plane < scale * scale; plane += 1) for (let channel = 0; channel < channels; channel += 1) {
      const sourceX = x * scale + plane % scale
      const sourceY = y * scale + Math.floor(plane / scale)
      output.push(input[(sourceY * width + sourceX) * channels + channel] ?? 0)
    }
  }
  return output
}

function pixelShuffle(input: readonly number[], width: number, height: number, channels: number, scale: number): number[] {
  const output = Array.from({ length: width * height * scale * scale * channels }, () => 0)
  for (let y = 0; y < height * scale; y += 1) for (let x = 0; x < width * scale; x += 1) {
    const sourceX = Math.floor(x / scale)
    const sourceY = Math.floor(y / scale)
    const pixel = ((y % scale) * scale + x % scale) * channels
    for (let channel = 0; channel < channels; channel += 1) {
      output[(y * width * scale + x) * channels + channel] = input[(sourceY * width + sourceX) * channels * scale * scale + pixel + channel] ?? 0
    }
  }
  return output
}
