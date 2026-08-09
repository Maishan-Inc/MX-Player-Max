import type { PlaybackTimeRange, Micros } from '@mx-player-max/types'

export interface RawPlaybackRange {
  start: number
  end: number
}

const MAX_RANGES = 64

export function normalizeMicros(value: number | null | undefined): Micros | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null
  const rounded = Math.round(value)
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : null
}

export function normalizePlaybackRanges(
  input: readonly RawPlaybackRange[] | TimeRanges | null | undefined,
  duration: Micros | null = null,
): readonly PlaybackTimeRange[] {
  if (input === null || input === undefined) return []
  const values: PlaybackTimeRange[] = []
  const length = typeof (input as { length?: unknown }).length === 'number'
    ? Math.max(0, Math.floor((input as { length: number }).length))
    : 0
  for (let index = 0; index < length; index += 1) {
    let start: number
    let end: number
    try {
      const value = input as TimeRanges
      if (typeof (input as { start?: unknown }).start === 'function') {
        start = value.start(index) * 1_000_000
        end = value.end(index) * 1_000_000
      } else {
        const range = (input as readonly RawPlaybackRange[])[index]
        if (!range) continue
        start = range.start
        end = range.end
      }
    } catch {
      continue
    }
    const normalizedStart = normalizeMicros(start)
    const normalizedEnd = normalizeMicros(end)
    if (normalizedStart === null || normalizedEnd === null || normalizedEnd <= normalizedStart) continue
    const cappedStart = duration === null ? normalizedStart : Math.min(normalizedStart, duration)
    const cappedEnd = duration === null ? normalizedEnd : Math.min(normalizedEnd, duration)
    if (cappedEnd <= cappedStart) continue
    values.push({ start: cappedStart, end: cappedEnd })
  }
  values.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: Array<{ start: number; end: number }> = []
  for (const range of values) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) {
      if (range.end > previous.end) previous.end = range.end
      continue
    }
    merged.push({ start: range.start, end: range.end })
  }
  return merged.length <= MAX_RANGES ? merged : merged.slice(merged.length - MAX_RANGES)
}

export function rangeContaining(
  ranges: readonly PlaybackTimeRange[],
  time: Micros | null,
): PlaybackTimeRange | null {
  if (time === null) return null
  for (const range of ranges) {
    if (time >= range.start && time <= range.end) return range
  }
  return null
}

export function bufferedAhead(
  ranges: readonly PlaybackTimeRange[],
  currentTime: Micros | null,
): Micros {
  const range = rangeContaining(ranges, currentTime)
  if (!range || currentTime === null) return 0
  return Math.max(0, range.end - currentTime)
}
