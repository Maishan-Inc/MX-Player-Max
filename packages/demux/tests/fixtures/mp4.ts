function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function typeBytes(type: string): Uint8Array {
  return Uint8Array.from([...type].map((character) => character.charCodeAt(0)))
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value)
  return bytes
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value)
  return bytes
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32(payload.byteLength + 8), typeBytes(type), payload)
}

function extendedBox(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32(1), typeBytes(type), u64(BigInt(payload.byteLength + 16)), payload)
}

function sizeZeroBox(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32(0), typeBytes(type), payload)
}

function fullBox(version: number, flags: number, payload: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff), payload)
}

function mvhd(duration: number): Uint8Array {
  const payload = new Uint8Array(100)
  const view = new DataView(payload.buffer)
  view.setUint32(12, 1_000)
  view.setUint32(16, duration)
  return box('mvhd', payload)
}

function tkhd(): Uint8Array {
  const payload = new Uint8Array(84)
  const view = new DataView(payload.buffer)
  view.setUint32(12, 1)
  view.setUint32(76, 320 << 16)
  view.setUint32(80, 180 << 16)
  return box('tkhd', payload)
}

function mdhd(duration: number): Uint8Array {
  const payload = new Uint8Array(24)
  const view = new DataView(payload.buffer)
  view.setUint32(12, 1_000)
  view.setUint32(16, duration)
  view.setUint16(20, (5 << 10) | (14 << 5) | 7)
  return box('mdhd', payload)
}

function hdlr(): Uint8Array {
  const payload = new Uint8Array(24)
  payload.set(typeBytes('vide'), 8)
  return box('hdlr', payload)
}

interface VisualSampleEntryOptions {
  type?: string
  configType?: string
  config?: Uint8Array
}

interface MoovOptions {
  empty?: boolean
  fragmented?: boolean
  co64?: boolean
  overflowOffset?: boolean
  videoSampleEntry?: VisualSampleEntryOptions
}

function visualSampleEntry(options: VisualSampleEntryOptions = {}): Uint8Array {
  const fields = new Uint8Array(70)
  const view = new DataView(fields.buffer)
  view.setUint16(6, 1)
  view.setUint16(24, 320)
  view.setUint16(26, 180)
  const config = box(options.configType ?? 'avcC', options.config ?? Uint8Array.of(1, 0x64, 0, 0x1f, 0xff))
  return box(options.type ?? 'avc1', concat(fields, config))
}

function table(type: string, entries: readonly Uint8Array[]): Uint8Array {
  return box(type, fullBox(0, 0, concat(u32(entries.length), ...entries)))
}

function createStbl(chunkOffset: bigint, options: MoovOptions): Uint8Array {
  const empty = options.empty === true
  const stsd = box('stsd', fullBox(0, 0, concat(u32(1), visualSampleEntry(options.videoSampleEntry))))
  const stts = table('stts', empty ? [] : [concat(u32(2), u32(1_000))])
  const ctts = empty ? null : table('ctts', [concat(u32(1), u32(0)), concat(u32(1), u32(500))])
  const stsc = table('stsc', empty ? [] : [concat(u32(1), u32(2), u32(1))])
  const stsz = box('stsz', fullBox(0, 0, concat(
    u32(0),
    u32(empty ? 0 : 2),
    ...(empty ? [] : [u32(2), u32(2)]),
  )))
  const actualOffset = options.overflowOffset === true ? BigInt(Number.MAX_SAFE_INTEGER) + 1n : chunkOffset
  const offsets = options.co64 === true
    ? table('co64', empty ? [] : [u64(actualOffset)])
    : table('stco', empty ? [] : [u32(Number(actualOffset))])
  const stss = empty ? null : table('stss', [u32(1)])
  return box('stbl', concat(stsd, stts, ...(ctts === null ? [] : [ctts]), stsc, stsz, offsets, ...(stss === null ? [] : [stss])))
}

function createMoov(chunkOffset: bigint, options: MoovOptions): Uint8Array {
  const stbl = createStbl(chunkOffset, options)
  const minf = box('minf', stbl)
  const mdia = box('mdia', concat(mdhd(options.empty === true ? 0 : 2_000), hdlr(), minf))
  const trak = box('trak', concat(tkhd(), mdia))
  const mvex = options.fragmented === true ? box('mvex', new Uint8Array()) : new Uint8Array()
  return box('moov', concat(mvhd(options.empty === true ? 0 : 2_000), trak, mvex))
}

export interface Mp4FixtureOptions {
  tailMoov?: boolean
  extendedFree?: boolean
  sizeZeroMdat?: boolean
  co64?: boolean
  overflowOffset?: boolean
  videoSampleEntry?: VisualSampleEntryOptions
}

export function createMp4Fixture(options: Mp4FixtureOptions = {}): Uint8Array {
  const ftyp = box('ftyp', concat(typeBytes('isom'), u32(0), typeBytes('isom'), typeBytes('mp42')))
  const free = options.extendedFree === true ? extendedBox('free', Uint8Array.of(0xaa)) : new Uint8Array()
  const mdatPayload = Uint8Array.of(0xaa, 0xab, 0xba, 0xbb)
  if (options.tailMoov === true) {
    const mdat = box('mdat', mdatPayload)
    const chunkOffset = BigInt(ftyp.byteLength + free.byteLength + 8)
    return concat(ftyp, free, mdat, createMoov(chunkOffset, options))
  }
  const temporaryMoov = createMoov(0n, options)
  const chunkOffset = BigInt(ftyp.byteLength + free.byteLength + temporaryMoov.byteLength + 8)
  const moov = createMoov(chunkOffset, options)
  const mdat = options.sizeZeroMdat === true ? sizeZeroBox('mdat', mdatPayload) : box('mdat', mdatPayload)
  return concat(ftyp, free, moov, mdat)
}

export function createFragmentedMp4Fixture(): Uint8Array {
  const ftyp = box('ftyp', concat(typeBytes('iso6'), u32(0), typeBytes('iso6'), typeBytes('dash')))
  const moov = createMoov(0n, { empty: true, fragmented: true, co64: false, overflowOffset: false })
  return concat(ftyp, moov, box('moof', new Uint8Array()))
}

export function createInvalidMp4BoxSizeFixture(): Uint8Array {
  return concat(u32(4), typeBytes('ftyp'), new Uint8Array(16))
}

