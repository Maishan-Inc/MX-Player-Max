import { ErrorCodes } from '@mx-player-max/types'
import { DemuxError } from '../../range/errors'
import { checkedAdd } from '../../range/validation'
import { BoundedRangeReader } from '../bounded-reader'
import type { DemuxLimits } from '../limits'

export interface Mp4Box {
  type: string
  start: number
  size: number
  headerSize: number
  dataStart: number
  end: number
}

export function readUint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.byteLength) {
    throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 uint32 is truncated')
  }
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset)
}

export function readInt32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.byteLength) {
    throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 int32 is truncated')
  }
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(offset)
}

export function readUint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.byteLength) {
    throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 uint16 is truncated')
  }
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset)
}

export function readUint64(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 8 > data.byteLength) {
    throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 uint64 is truncated')
  }
  const value = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 uint64 exceeds the safe integer range')
  }
  return Number(value)
}

function fourCc(data: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > data.byteLength) {
    throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 box type is truncated')
  }
  return String.fromCharCode(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0)
}

function validateBoxSize(size: number, headerSize: number, limits: DemuxLimits): void {
  if (!Number.isSafeInteger(size) || size < headerSize) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 box size is smaller than its header')
  }
  if (size > limits.maxElementSizeBytes) {
    throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'MP4 box exceeds the declared-size budget')
  }
}

export function parseMemoryBox(
  data: Uint8Array,
  offset: number,
  parentEnd: number,
  limits: DemuxLimits,
): Mp4Box {
  const size32 = readUint32(data, offset)
  const type = fourCc(data, offset + 4)
  let headerSize = 8
  let size: number
  if (size32 === 1) {
    size = readUint64(data, offset + 8)
    headerSize = 16
  } else if (size32 === 0) {
    size = parentEnd - offset
  } else {
    size = size32
  }
  if (type === 'uuid') headerSize += 16
  validateBoxSize(size, headerSize, limits)
  const end = checkedAdd(offset, size)
  if (end > parentEnd) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 box exceeds its parent boundary')
  return { type, start: offset, size, headerSize, dataStart: offset + headerSize, end }
}

export function readMemoryBoxes(
  data: Uint8Array,
  start: number,
  end: number,
  limits: DemuxLimits,
  depth = 1,
): Mp4Box[] {
  if (depth > limits.maxNestingDepth) {
    throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'MP4 nesting exceeds the configured depth')
  }
  const boxes: Mp4Box[] = []
  let offset = start
  while (offset < end) {
    const box = parseMemoryBox(data, offset, end, limits)
    if (box.end <= offset) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 child did not advance the parser')
    boxes.push(box)
    offset = box.end
  }
  if (offset !== end) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 child boxes do not fill their parent')
  return boxes
}

export async function readStreamBox(
  reader: BoundedRangeReader,
  offset: number,
  parentEnd: number | null,
  limits: DemuxLimits,
): Promise<Mp4Box> {
  const knownEnd = parentEnd ?? reader.sourceLength
  if (knownEnd !== null && knownEnd - offset < 8) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 box header is truncated')
  const baseHeader = await reader.readAt(offset, 8)
  const size32 = readUint32(baseHeader, 0)
  const type = fourCc(baseHeader, 4)
  let headerSize = 8
  let size: number
  if (size32 === 1) {
    if (knownEnd !== null && knownEnd - offset < 16) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 large-size header is truncated')
    size = readUint64(await reader.readAt(offset + 8, 8), 0)
    headerSize = 16
  } else if (size32 === 0) {
    if (knownEnd === null) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'size=0 MP4 box requires a known parent boundary')
    size = knownEnd - offset
  } else {
    size = size32
  }
  if (type === 'uuid') {
    if (knownEnd !== null && knownEnd - offset < headerSize + 16) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 UUID header is truncated')
    await reader.readAt(offset + headerSize, 16)
    headerSize += 16
  }
  validateBoxSize(size, headerSize, limits)
  const end = checkedAdd(offset, size)
  if (knownEnd !== null && end > knownEnd) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 box exceeds the source or parent boundary')
  return { type, start: offset, size, headerSize, dataStart: offset + headerSize, end }
}

export function boxPayload(data: Uint8Array, box: Mp4Box): Uint8Array {
  return data.subarray(box.dataStart, box.end)
}
