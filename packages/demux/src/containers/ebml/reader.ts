import { ErrorCodes } from '@mx-player-max/types'
import { DemuxError } from '../../range/errors'
import { checkedAdd } from '../../range/validation'
import { BoundedRangeReader } from '../bounded-reader'
import type { DemuxLimits } from '../limits'

export interface EbmlVint {
  length: number
  value: number | null
}

export interface EbmlElement {
  id: number
  size: number | null
  headerStart: number
  headerSize: number
  dataStart: number
  dataEnd: number | null
}

export function ebmlVintLength(firstByte: number): number {
  for (let length = 1; length <= 8; length += 1) {
    if ((firstByte & (0x80 >> (length - 1))) !== 0) return length
  }
  throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML variable integer has no marker bit')
}

export function parseEbmlVint(data: Uint8Array, offset: number, forId = false): EbmlVint {
  const firstByte = data[offset]
  if (firstByte === undefined) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'EBML variable integer is truncated')
  const length = ebmlVintLength(firstByte)
  if ((forId && length > 4) || offset + length > data.byteLength) {
    throw new DemuxError(
      offset + length > data.byteLength ? ErrorCodes.CONTAINER_TRUNCATED : ErrorCodes.CONTAINER_INVALID,
      'EBML variable integer length is invalid',
    )
  }
  let value = BigInt(forId ? firstByte : firstByte & (0xff >> length))
  for (let index = 1; index < length; index += 1) {
    const byte = data[offset + index]
    if (byte === undefined) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'EBML variable integer is truncated')
    value = (value << 8n) | BigInt(byte)
  }
  if (!forId) {
    const unknown = (1n << BigInt(7 * length)) - 1n
    if (value === unknown) return { length, value: null }
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML variable integer exceeds the safe integer range')
  }
  return { length, value: Number(value) }
}

export function parseEbmlSignedVint(data: Uint8Array, offset: number): EbmlVint {
  const unsigned = parseEbmlVint(data, offset)
  if (unsigned.value === null) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Unknown-length marker is invalid in EBML lacing')
  const bias = 2 ** (7 * unsigned.length - 1) - 1
  return { length: unsigned.length, value: unsigned.value - bias }
}

export function parseMemoryElement(
  data: Uint8Array,
  offset: number,
  parentEnd: number,
  limits: DemuxLimits,
): EbmlElement {
  const id = parseEbmlVint(data, offset, true)
  const size = parseEbmlVint(data, offset + id.length)
  if (id.value === null) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML element ID cannot be unknown')
  const headerSize = id.length + size.length
  const dataStart = checkedAdd(offset, headerSize)
  const dataEnd = size.value === null ? parentEnd : checkedAdd(dataStart, size.value)
  if (dataEnd > parentEnd) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'EBML element exceeds its parent boundary')
  if (size.value !== null && size.value > limits.maxElementSizeBytes) {
    throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'EBML element exceeds the declared-size budget')
  }
  return { id: id.value, size: size.value, headerStart: offset, headerSize, dataStart, dataEnd }
}

export function readMemoryElements(
  data: Uint8Array,
  start: number,
  end: number,
  limits: DemuxLimits,
  depth = 1,
): EbmlElement[] {
  if (depth > limits.maxNestingDepth) {
    throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'EBML nesting exceeds the configured depth')
  }
  const elements: EbmlElement[] = []
  let offset = start
  while (offset < end) {
    const element = parseMemoryElement(data, offset, end, limits)
    if (element.dataEnd === null || element.dataEnd <= offset) {
      throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML child did not advance the parser')
    }
    elements.push(element)
    offset = element.dataEnd
  }
  if (offset !== end) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'EBML children do not fill their parent')
  return elements
}

export async function readStreamElement(
  reader: BoundedRangeReader,
  offset: number,
  parentEnd: number | null,
  limits: DemuxLimits,
): Promise<EbmlElement> {
  const knownEnd = parentEnd ?? reader.sourceLength
  if (knownEnd !== null && offset >= knownEnd) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'EBML element header is missing')
  const idFirst = await reader.readAt(offset, 1)
  const idLength = ebmlVintLength(idFirst[0] ?? 0)
  const sizeFirstOffset = checkedAdd(offset, idLength)
  if (knownEnd !== null && sizeFirstOffset >= knownEnd) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'EBML size field is missing')
  const sizeFirst = await reader.readAt(sizeFirstOffset, 1)
  const sizeLength = ebmlVintLength(sizeFirst[0] ?? 0)
  const required = idLength + sizeLength
  if (knownEnd !== null && offset + required > knownEnd) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'EBML element header is truncated')
  const header = await reader.readAt(offset, required)
  const id = parseEbmlVint(header, 0, true)
  const size = parseEbmlVint(header, id.length)
  if (id.value === null) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML element ID cannot be unknown')
  const headerSize = id.length + size.length
  const dataStart = checkedAdd(offset, headerSize)
  const dataEnd = size.value === null ? null : checkedAdd(dataStart, size.value)
  if (size.value !== null && size.value > limits.maxElementSizeBytes) {
    throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'EBML element exceeds the declared-size budget')
  }
  if (knownEnd !== null && dataEnd !== null && dataEnd > knownEnd) {
    throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'EBML element exceeds the source or parent boundary')
  }
  return { id: id.value, size: size.value, headerStart: offset, headerSize, dataStart, dataEnd }
}

export function elementPayload(data: Uint8Array, element: EbmlElement): Uint8Array {
  if (element.dataEnd === null) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Buffered EBML element cannot have an unbounded payload')
  return data.subarray(element.dataStart, element.dataEnd)
}

export function readEbmlUnsigned(data: Uint8Array): number {
  if (data.byteLength === 0 || data.byteLength > 8) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML unsigned integer has an invalid width')
  }
  let value = 0n
  for (const byte of data) value = (value << 8n) | BigInt(byte)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML unsigned integer exceeds the safe integer range')
  }
  return Number(value)
}

export function readEbmlFloat(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let value: number
  if (data.byteLength === 4) value = view.getFloat32(0)
  else if (data.byteLength === 8) value = view.getFloat64(0)
  else throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML float must use 4 or 8 bytes')
  if (!Number.isFinite(value)) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML float must be finite')
  return value
}

export function readEbmlText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/\0+$/u, '')
  } catch (cause) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML text is not valid UTF-8', { cause })
  }
}
