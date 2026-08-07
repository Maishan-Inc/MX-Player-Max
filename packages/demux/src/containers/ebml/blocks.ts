import { ErrorCodes, type DemuxPacket, type Micros, type TrackInfo } from '@mx-player-max/types'
import { DemuxError } from '../../range/errors'
import type { DemuxLimits } from '../limits'
import { parseEbmlSignedVint, parseEbmlVint } from './reader'

export interface EbmlTrackState {
  info: TrackInfo
  defaultDurationMicros: Micros | null
}

interface BlockOptions {
  clusterTimecode: number
  timecodeScale: number
  keyframe: boolean
  blockDurationTimecodes: number | null
  tracks: ReadonlyMap<number, EbmlTrackState>
  limits: DemuxLimits
}

function safeMicros(timecodes: number, timecodeScale: number): Micros {
  const value = Math.round((timecodes * timecodeScale) / 1_000)
  if (!Number.isSafeInteger(value)) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Matroska timestamp exceeds the safe microsecond range')
  }
  return value
}

function parseLaceSizes(data: Uint8Array, start: number, flags: number): { sizes: number[]; payloadStart: number } {
  const laceKind = (flags & 0x06) >> 1
  if (laceKind === 0) return { sizes: [data.byteLength - start], payloadStart: start }
  const laceCountMinusOne = data[start]
  if (laceCountMinusOne === undefined) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Laced block is missing its frame count')
  const frameCount = laceCountMinusOne + 1
  let cursor = start + 1
  const sizes: number[] = []

  if (laceKind === 1) {
    for (let frame = 0; frame < frameCount - 1; frame += 1) {
      let size = 0
      while (true) {
        const value = data[cursor]
        if (value === undefined) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Xiph lace size is truncated')
        cursor += 1
        size += value
        if (!Number.isSafeInteger(size)) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Xiph lace size overflowed')
        if (value !== 255) break
      }
      sizes.push(size)
    }
  } else if (laceKind === 2) {
    const remaining = data.byteLength - cursor
    if (remaining < 0 || remaining % frameCount !== 0) {
      throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Fixed lacing payload is not divisible by its frame count')
    }
    return { sizes: Array.from({ length: frameCount }, () => remaining / frameCount), payloadStart: cursor }
  } else {
    const first = parseEbmlVint(data, cursor)
    if (first.value === null) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML lace first size cannot be unknown')
    cursor += first.length
    sizes.push(first.value)
    for (let frame = 1; frame < frameCount - 1; frame += 1) {
      const delta = parseEbmlSignedVint(data, cursor)
      if (delta.value === null) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML lace delta cannot be unknown')
      cursor += delta.length
      const previous = sizes[frame - 1]
      if (previous === undefined) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML lace has no previous size')
      const size = previous + delta.value
      if (!Number.isSafeInteger(size) || size < 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML lace size is invalid')
      sizes.push(size)
    }
  }

  const declared = sizes.reduce((sum, size) => sum + size, 0)
  const finalSize = data.byteLength - cursor - declared
  if (!Number.isSafeInteger(finalSize) || finalSize < 0) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Lace sizes exceed the block payload')
  }
  sizes.push(finalSize)
  return { sizes, payloadStart: cursor }
}

export function parseEbmlBlock(data: Uint8Array, options: BlockOptions): DemuxPacket[] {
  const trackVint = parseEbmlVint(data, 0)
  if (trackVint.value === null || trackVint.value <= 0) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Block track number is invalid')
  }
  const timecodeOffset = trackVint.length
  const high = data[timecodeOffset]
  const low = data[timecodeOffset + 1]
  const flags = data[timecodeOffset + 2]
  if (high === undefined || low === undefined || flags === undefined) {
    throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Block header is truncated')
  }
  let relativeTimecode = (high << 8) | low
  if ((relativeTimecode & 0x8000) !== 0) relativeTimecode -= 0x1_0000
  const track = options.tracks.get(trackVint.value)
  if (track === undefined) return []
  const lace = parseLaceSizes(data, timecodeOffset + 3, flags)
  const blockTimecode = options.clusterTimecode + relativeTimecode
  if (!Number.isSafeInteger(blockTimecode)) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Block timecode overflowed')

  const totalDuration = options.blockDurationTimecodes === null
    ? null
    : safeMicros(options.blockDurationTimecodes, options.timecodeScale)
  const packets: DemuxPacket[] = []
  let cursor = lace.payloadStart
  let elapsed = 0
  for (let index = 0; index < lace.sizes.length; index += 1) {
    const size = lace.sizes[index]
    if (size === undefined || size > options.limits.maxPacketBytes) {
      throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'Matroska packet exceeds the configured budget')
    }
    const end = cursor + size
    if (!Number.isSafeInteger(end) || end > data.byteLength) {
      throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Matroska packet exceeds its block payload')
    }
    let duration = track.defaultDurationMicros
    if (totalDuration !== null) {
      const startBoundary = Math.round((totalDuration * index) / lace.sizes.length)
      const endBoundary = Math.round((totalDuration * (index + 1)) / lace.sizes.length)
      duration = endBoundary - startBoundary
      elapsed = startBoundary
    } else if (duration !== null) {
      elapsed = duration * index
    }
    packets.push({
      trackId: track.info.id,
      kind: track.info.kind,
      timestamp: safeMicros(blockTimecode, options.timecodeScale) + elapsed,
      duration,
      keyframe: options.keyframe,
      data: data.slice(cursor, end),
    })
    cursor = end
  }
  if (cursor !== data.byteLength) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Block lacing did not consume its payload')
  return packets
}

