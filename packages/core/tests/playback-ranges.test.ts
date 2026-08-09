import { describe, expect, it } from 'vitest'
import { bufferedAhead, normalizeMicros, normalizePlaybackRanges } from '../src/playback/ranges'

describe('playback range normalization', () => {
  it('rejects unsafe values, sorts ranges, and merges only overlap or adjacency', () => {
    expect(normalizeMicros(Number.POSITIVE_INFINITY)).toBeNull()
    expect(normalizeMicros(-1)).toBeNull()
    expect(normalizePlaybackRanges([
      { start: 30, end: 40 },
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 22, end: 25 },
      { start: Number.NaN, end: 30 },
      { start: 5, end: 5 },
    ])).toEqual([{ start: 0, end: 20 }, { start: 22, end: 25 }, { start: 30, end: 40 }])
  })

  it('clamps to duration and retains the latest 64 disjoint ranges', () => {
    const ranges = Array.from({ length: 70 }, (_, index) => ({ start: index * 3, end: index * 3 + 1 }))
    const normalized = normalizePlaybackRanges(ranges, 200)
    expect(normalized).toHaveLength(64)
    expect(normalized[0]).toEqual({ start: 9, end: 10 })
    expect(normalized.at(-1)).toEqual({ start: 198, end: 199 })
  })

  it('computes buffered ahead without bridging a real gap', () => {
    const ranges = normalizePlaybackRanges([{ start: 0, end: 10 }, { start: 20, end: 30 }])
    expect(bufferedAhead(ranges, 5)).toBe(5)
    expect(bufferedAhead(ranges, 15)).toBe(0)
  })
})
