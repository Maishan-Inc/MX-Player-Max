import { ErrorCodes, type Micros, type TrackInfo, type TrackKind } from '@mx-player-max/types'
import { DemuxError } from '../../range/errors'
import { checkedAdd } from '../../range/validation'
import type { DemuxLimits } from '../limits'

export interface TimeToSampleEntry {
  count: number
  delta: number
}

export interface CompositionOffsetEntry {
  count: number
  offset: number
}

export interface SampleToChunkEntry {
  firstChunk: number
  samplesPerChunk: number
  sampleDescriptionIndex: number
}

export interface MediaDataRange {
  start: number
  end: number
}

export interface Mp4TrackTable {
  info: TrackInfo
  kind: TrackKind
  timescale: number
  sampleSizes: readonly number[]
  chunkOffsets: readonly number[]
  sampleToChunk: readonly SampleToChunkEntry[]
  timeToSample: readonly TimeToSampleEntry[]
  compositionOffsets: readonly CompositionOffsetEntry[] | null
  syncSamples: ReadonlySet<number> | null
}

export interface Mp4Sample {
  trackId: number
  kind: TrackKind
  offset: number
  size: number
  dts: Micros
  pts: Micros
  duration: Micros
  keyframe: boolean
}

function toMicros(value: number, timescale: number): Micros {
  const micros = Math.round((value * 1_000_000) / timescale)
  if (!Number.isSafeInteger(micros)) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 timestamp exceeds the safe microsecond range')
  return micros
}

function expandTiming(table: Mp4TrackTable, limits: DemuxLimits): { dts: number[]; durations: number[]; offsets: number[] } {
  const sampleCount = table.sampleSizes.length
  const maximumSamples = limits.maxKeyframes * 4
  if (sampleCount > maximumSamples) {
    throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'MP4 sample count exceeds the index budget', {
      context: { sampleCount, limit: maximumSamples },
    })
  }
  const dts: number[] = []
  const durations: number[] = []
  let current = 0
  for (const entry of table.timeToSample) {
    if (entry.count <= 0 || entry.delta <= 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stts entries must have positive count and delta')
    for (let index = 0; index < entry.count; index += 1) {
      if (dts.length >= sampleCount) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stts contains more samples than stsz')
      dts.push(current)
      durations.push(entry.delta)
      current = checkedAdd(current, entry.delta)
    }
  }
  if (dts.length !== sampleCount) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stts sample count does not match stsz')
  const offsets: number[] = []
  if (table.compositionOffsets === null) {
    for (let index = 0; index < sampleCount; index += 1) offsets.push(0)
  } else {
    for (const entry of table.compositionOffsets) {
      if (entry.count <= 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'ctts entry count must be positive')
      for (let index = 0; index < entry.count; index += 1) {
        if (offsets.length >= sampleCount) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'ctts contains more samples than stsz')
        offsets.push(entry.offset)
      }
    }
    if (offsets.length !== sampleCount) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'ctts sample count does not match stsz')
  }
  return { dts, durations, offsets }
}

function containsSample(ranges: readonly MediaDataRange[], offset: number, size: number): boolean {
  const end = checkedAdd(offset, size)
  return ranges.some((range) => offset >= range.start && end <= range.end)
}

export function buildMp4Samples(
  table: Mp4TrackTable,
  mediaData: readonly MediaDataRange[],
  limits: DemuxLimits,
): Mp4Sample[] {
  if (!Number.isSafeInteger(table.timescale) || table.timescale <= 0) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 media timescale must be positive')
  }
  if (table.sampleToChunk.length === 0 && table.sampleSizes.length > 0) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stsc is missing for non-empty samples')
  }
  let previousFirstChunk = 0
  for (const entry of table.sampleToChunk) {
    if (entry.firstChunk <= previousFirstChunk || entry.samplesPerChunk <= 0 || entry.sampleDescriptionIndex <= 0) {
      throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stsc entries are invalid or unsorted')
    }
    if (entry.sampleDescriptionIndex !== 1) {
      throw new DemuxError(ErrorCodes.CONTAINER_UNSUPPORTED, 'Multiple MP4 sample descriptions are not supported in Phase 2')
    }
    previousFirstChunk = entry.firstChunk
  }
  const timing = expandTiming(table, limits)
  const offsets: number[] = []
  let sampleIndex = 0
  let stscIndex = 0
  for (let chunkIndex = 1; chunkIndex <= table.chunkOffsets.length; chunkIndex += 1) {
    while (
      stscIndex + 1 < table.sampleToChunk.length
      && (table.sampleToChunk[stscIndex + 1]?.firstChunk ?? Number.MAX_SAFE_INTEGER) <= chunkIndex
    ) stscIndex += 1
    const mapping = table.sampleToChunk[stscIndex]
    const chunkOffset = table.chunkOffsets[chunkIndex - 1]
    if (mapping === undefined || chunkOffset === undefined) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 chunk mapping is incomplete')
    let offset = chunkOffset
    for (let inChunk = 0; inChunk < mapping.samplesPerChunk; inChunk += 1) {
      const size = table.sampleSizes[sampleIndex]
      if (size === undefined) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stsc maps more samples than stsz')
      if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxPacketBytes) {
        throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'MP4 sample size exceeds the packet budget')
      }
      offsets.push(offset)
      offset = checkedAdd(offset, size)
      sampleIndex += 1
    }
  }
  if (sampleIndex !== table.sampleSizes.length) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stsc/chunk offsets do not map every sample')

  const samples: Mp4Sample[] = []
  for (let index = 0; index < table.sampleSizes.length; index += 1) {
    const offset = offsets[index]
    const size = table.sampleSizes[index]
    const dts = timing.dts[index]
    const delta = timing.durations[index]
    const compositionOffset = timing.offsets[index]
    if (offset === undefined || size === undefined || dts === undefined || delta === undefined || compositionOffset === undefined) {
      throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 sample index is incomplete')
    }
    if (!containsSample(mediaData, offset, size)) {
      throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 sample does not fall within mdat')
    }
    const sampleNumber = index + 1
    samples.push({
      trackId: table.info.id,
      kind: table.kind,
      offset,
      size,
      dts: toMicros(dts, table.timescale),
      pts: toMicros(dts + compositionOffset, table.timescale),
      duration: toMicros(delta, table.timescale),
      keyframe: table.syncSamples === null || table.syncSamples.has(sampleNumber),
    })
  }
  return samples
}
