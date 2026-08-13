import { createWasmError } from '@mx-player-max/decoder-wasm'
import { ErrorCodes, type Micros } from '@mx-player-max/types'

export const MXWF_ABI_VERSION = 1
export const MXWF_DESCRIPTOR_BYTES = 160
export const MXWF_MAGIC = 0x4d585746

const MAX_FRAME_BYTES = 256 * 1024 * 1024
const DURATION_PRESENT = 1

export interface MxwfPlane {
  readonly offset: number
  readonly stride: number
  readonly rows: number
  readonly rowBytes: number
  readonly byteLength: number
}

export interface MxwfFrameDescriptor {
  readonly token: number
  readonly codedWidth: number
  readonly codedHeight: number
  readonly visibleRect: DOMRectInit
  readonly displayWidth: number
  readonly displayHeight: number
  readonly timestamp: Micros
  readonly duration: Micros | null
  readonly colorSpace: VideoColorSpaceInit
  readonly planes: readonly [MxwfPlane, MxwfPlane, MxwfPlane]
}

export interface MxwfFrameFactory {
  create(data: Uint8Array, init: VideoFrameBufferInit): VideoFrame
}

const browserFrameFactory: MxwfFrameFactory = {
  create(data, init) {
    if (typeof VideoFrame === 'undefined') throw invalid('VideoFrame is unavailable in the decoder Worker')
    return new VideoFrame(data, init)
  },
}

export function readMxwfFrameDescriptor(memory: WebAssembly.Memory, pointer: number): MxwfFrameDescriptor {
  const buffer = memory.buffer
  assertRange(pointer, MXWF_DESCRIPTOR_BYTES, buffer.byteLength, 'descriptor')
  const view = new DataView(buffer, pointer, MXWF_DESCRIPTOR_BYTES)
  if (readU32(view, 0) !== MXWF_MAGIC) throw invalid('MXWF frame magic is invalid')
  if (readU32(view, 4) !== MXWF_ABI_VERSION) throw invalid('MXWF frame ABI version is unsupported')
  if (readU32(view, 8) !== MXWF_DESCRIPTOR_BYTES) throw invalid('MXWF descriptor length is invalid')
  const token = positiveU32(readU32(view, 12), 'frame token')
  if (readU32(view, 16) !== 1) throw invalid('MXWF pixel format is not I420')
  const flags = readU32(view, 20)
  if ((flags & ~3) !== 0) throw invalid('MXWF frame flags are invalid')
  const codedWidth = dimension(readU32(view, 24), 'coded width')
  const codedHeight = dimension(readU32(view, 28), 'coded height')
  const visibleX = readU32(view, 32)
  const visibleY = readU32(view, 36)
  const visibleWidth = dimension(readU32(view, 40), 'visible width')
  const visibleHeight = dimension(readU32(view, 44), 'visible height')
  if (visibleX + visibleWidth > codedWidth || visibleY + visibleHeight > codedHeight) throw invalid('MXWF visible rectangle exceeds coded dimensions')
  const displayWidth = dimension(readU32(view, 48), 'display width')
  const displayHeight = dimension(readU32(view, 52), 'display height')
  const timestamp = readMicros(view, 56, 'timestamp')
  const duration = (flags & DURATION_PRESENT) === 0 ? null : readMicros(view, 64, 'duration')
  if (readU32(view, 88) !== 3 || readU32(view, 92) !== 0 || readU32(view, 156) !== 0) throw invalid('MXWF plane count or reserved fields are invalid')
  const planes = [readPlane(view, 96, buffer.byteLength), readPlane(view, 116, buffer.byteLength), readPlane(view, 136, buffer.byteLength)] as const
  validateI420Planes(planes, codedWidth, codedHeight)
  validateNonOverlapping(planes)
  return {
    token,
    codedWidth,
    codedHeight,
    visibleRect: { x: visibleX, y: visibleY, width: visibleWidth, height: visibleHeight },
    displayWidth,
    displayHeight,
    timestamp,
    duration,
    colorSpace: readColorSpace(view),
    planes,
  }
}

export function createVideoFrameFromMxwf(
  memory: WebAssembly.Memory,
  descriptorPointer: number,
  release: (token: number) => void,
  factory: MxwfFrameFactory = browserFrameFactory,
): VideoFrame {
  let token = 0
  try {
    const descriptor = readMxwfFrameDescriptor(memory, descriptorPointer)
    token = descriptor.token
    const start = Math.min(...descriptor.planes.map((plane) => plane.offset))
    const end = Math.max(...descriptor.planes.map((plane) => plane.offset + plane.byteLength))
    const data = new Uint8Array(memory.buffer, start, end - start)
    const layout = descriptor.planes.map((plane) => ({ offset: plane.offset - start, stride: plane.stride }))
    const init: VideoFrameBufferInit = {
      format: 'I420',
      codedWidth: descriptor.codedWidth,
      codedHeight: descriptor.codedHeight,
      visibleRect: descriptor.visibleRect,
      displayWidth: descriptor.displayWidth,
      displayHeight: descriptor.displayHeight,
      timestamp: descriptor.timestamp,
      layout,
      colorSpace: descriptor.colorSpace,
      ...(descriptor.duration === null ? {} : { duration: descriptor.duration }),
    }
    return factory.create(data, init)
  } finally {
    if (token !== 0) release(token)
  }
}

function readPlane(view: DataView, offset: number, memoryBytes: number): MxwfPlane {
  const plane: MxwfPlane = {
    offset: readU32(view, offset),
    stride: positiveU32(readU32(view, offset + 4), 'plane stride'),
    rows: positiveU32(readU32(view, offset + 8), 'plane rows'),
    rowBytes: positiveU32(readU32(view, offset + 12), 'plane row bytes'),
    byteLength: positiveU32(readU32(view, offset + 16), 'plane byte length'),
  }
  if (plane.rowBytes > plane.stride) throw invalid('MXWF plane row bytes exceed stride')
  const required = checkedMultiply(plane.stride, plane.rows)
  if (plane.byteLength < required || plane.byteLength > MAX_FRAME_BYTES) throw invalid('MXWF plane byte length is invalid')
  assertRange(plane.offset, plane.byteLength, memoryBytes, 'plane')
  return plane
}

function validateI420Planes(planes: readonly MxwfPlane[], width: number, height: number): void {
  const chromaWidth = Math.ceil(width / 2)
  const chromaHeight = Math.ceil(height / 2)
  const expected = [
    { rowBytes: width, rows: height },
    { rowBytes: chromaWidth, rows: chromaHeight },
    { rowBytes: chromaWidth, rows: chromaHeight },
  ] as const
  for (let index = 0; index < expected.length; index += 1) {
    const plane = planes[index]
    const requirement = expected[index]
    if (!plane || !requirement || plane.rowBytes !== requirement.rowBytes || plane.rows !== requirement.rows) throw invalid('MXWF I420 plane dimensions are invalid')
  }
}

function validateNonOverlapping(planes: readonly MxwfPlane[]): void {
  const ranges = planes.map((plane) => ({ start: plane.offset, end: plane.offset + plane.byteLength })).sort((left, right) => left.start - right.start)
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1]
    const current = ranges[index]
    if (!previous || !current || current.start < previous.end) throw invalid('MXWF frame planes overlap')
  }
}

function readColorSpace(view: DataView): VideoColorSpaceInit {
  const primaries = enumValue(readU32(view, 72), [undefined, 'bt709', 'bt470bg', 'smpte170m', undefined] as const, 'color primaries')
  const transfer = enumValue(readU32(view, 76), [undefined, 'bt709', 'smpte170m', 'iec61966-2-1', undefined, undefined] as const, 'color transfer')
  const matrix = enumValue(readU32(view, 80), [undefined, 'rgb', 'bt709', 'bt470bg', 'smpte170m', undefined] as const, 'color matrix')
  const range = readU32(view, 84)
  if (range > 2) throw invalid('MXWF color range is invalid')
  return {
    ...(primaries === undefined ? {} : { primaries }),
    ...(transfer === undefined ? {} : { transfer }),
    ...(matrix === undefined ? {} : { matrix }),
    ...(range === 0 ? {} : { fullRange: range === 2 }),
  }
}

function enumValue<const T extends readonly (string | undefined)[]>(value: number, values: T, field: string): T[number] {
  if (value >= values.length) throw invalid(`MXWF ${field} is invalid`)
  return values[value]
}

function readMicros(view: DataView, offset: number, field: string): Micros {
  const value = readU32(view, offset) + readU32(view, offset + 4) * 0x1_0000_0000
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`MXWF ${field} is invalid`)
  return value
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

function dimension(value: number, field: string): number {
  if (value === 0 || value > 16_384) throw invalid(`MXWF ${field} is invalid`)
  return value
}

function positiveU32(value: number, field: string): number {
  if (value === 0) throw invalid(`MXWF ${field} is invalid`)
  return value
}

function checkedMultiply(left: number, right: number): number {
  const value = left * right
  if (!Number.isSafeInteger(value) || value > 0xffff_ffff) throw invalid('MXWF plane size overflows uint32')
  return value
}

function assertRange(offset: number, length: number, total: number, field: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > total || length > total - offset) throw invalid(`MXWF ${field} range is invalid`)
}

function invalid(message: string) {
  return createWasmError(ErrorCodes.WASM_FRAME_ABI_INVALID, message, false)
}
