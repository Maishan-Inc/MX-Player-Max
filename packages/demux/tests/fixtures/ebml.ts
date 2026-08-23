function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function idBytes(id: number): Uint8Array {
  const bytes: number[] = []
  let value = id
  while (value > 0) {
    bytes.unshift(value & 0xff)
    value = Math.floor(value / 256)
  }
  return Uint8Array.from(bytes)
}

function sizeVint(value: number): Uint8Array {
  for (let length = 1; length <= 8; length += 1) {
    const maximum = 2 ** (7 * length) - 2
    if (value > maximum) continue
    const bytes = new Uint8Array(length)
    let remaining = value
    for (let index = length - 1; index >= 0; index -= 1) {
      bytes[index] = remaining & 0xff
      remaining = Math.floor(remaining / 256)
    }
    const first = bytes[0]
    if (first === undefined) throw new Error('fixture vint has no first byte')
    bytes[0] = first | (0x80 >> (length - 1))
    return bytes
  }
  throw new Error('fixture size is too large')
}

function unsignedBytes(value: number): Uint8Array {
  if (value === 0) return Uint8Array.of(0)
  const bytes: number[] = []
  let remaining = value
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining = Math.floor(remaining / 256)
  }
  return Uint8Array.from(bytes)
}

function float64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value)
  return bytes
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function element(id: number, payload: Uint8Array, unknownSize = false): Uint8Array {
  return concat(idBytes(id), unknownSize ? Uint8Array.of(0xff) : sizeVint(payload.byteLength), payload)
}

function uintElement(id: number, value: number): Uint8Array {
  return element(id, unsignedBytes(value))
}

function textElement(id: number, value: string): Uint8Array {
  return element(id, text(value))
}

function trackEntry(options: {
  number: number
  type: 1 | 2
  codecId: string
}): Uint8Array {
  const common = [
    uintElement(0xd7, options.number),
    uintElement(0x83, options.type),
    textElement(0x86, options.codecId),
    textElement(0x22b59c, 'eng'),
    textElement(0x536e, options.type === 1 ? 'Video' : 'Audio'),
  ]
  if (options.type === 1) {
    return element(0xae, concat(
      ...common,
      uintElement(0x23e383, 33_333_333),
      element(0xe0, concat(uintElement(0xb0, 320), uintElement(0xba, 180))),
    ))
  }
  const codecPrivate = options.codecId === 'A_AAC'
    ? Uint8Array.of(0x11, 0x90)
    : options.codecId === 'A_OPUS'
      ? concat(new TextEncoder().encode('OpusHead'), Uint8Array.of(1, 2, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0))
      : null
  return element(0xae, concat(
    ...common,
    ...(codecPrivate === null ? [] : [element(0x63a2, codecPrivate)]),
    element(0xe1, concat(element(0xb5, float64(48_000)), uintElement(0x9f, 2))),
  ))
}

function blockPayload(track: number, timestamp: number, flags: number, payload: Uint8Array): Uint8Array {
  if (track < 1 || track > 126) throw new Error('fixture uses one-byte track numbers only')
  const timecode = new Uint8Array(2)
  new DataView(timecode.buffer).setInt16(0, timestamp)
  return concat(Uint8Array.of(0x80 | track), timecode, Uint8Array.of(flags), payload)
}

function simpleBlock(track: number, timestamp: number, flags: number, payload: Uint8Array): Uint8Array {
  return element(0xa3, blockPayload(track, timestamp, flags, payload))
}

function cuePoint(clusterPosition: number): Uint8Array {
  return element(0xbb, concat(
    uintElement(0xb3, 0),
    element(0xb7, concat(uintElement(0xf7, 1), uintElement(0xf1, clusterPosition))),
  ))
}

export interface EbmlFixtureOptions {
  docType?: 'matroska' | 'webm'
  cues?: boolean
  unknownSegment?: boolean
  unknownCluster?: boolean
  fixedLacing?: boolean
  lacing?: 'none' | 'fixed' | 'xiph' | 'ebml'
  blockGroup?: boolean
  videoCodecId?: string
  audioCodecId?: string
  /** Replaces the placeholder video frame, so a codec that carries its profile in-band can be read. */
  videoPayload?: Uint8Array
  /** Clears the key-frame flag on the video SimpleBlock. */
  videoInterFrame?: boolean
}

export function createEbmlFixture(options: EbmlFixtureOptions = {}): Uint8Array {
  const docType = options.docType ?? 'matroska'
  const ebmlHeader = element(0x1a45dfa3, concat(
    uintElement(0x42f2, 4),
    uintElement(0x42f3, 8),
    textElement(0x4282, docType),
  ))
  const info = element(0x1549a966, concat(
    uintElement(0x2ad7b1, 1_000_000),
    element(0x4489, float64(2_000)),
  ))
  const tracks = element(0x1654ae6b, concat(
    trackEntry({ number: 1, type: 1, codecId: options.videoCodecId ?? (docType === 'webm' ? 'V_VP9' : 'V_MPEG4/ISO/AVC') }),
    trackEntry({ number: 2, type: 2, codecId: options.audioCodecId ?? (docType === 'webm' ? 'A_OPUS' : 'A_AAC') }),
  ))
  const lacing = options.lacing ?? (options.fixedLacing === true ? 'fixed' : 'none')
  let videoBlock: Uint8Array
  if (options.blockGroup === true) {
    videoBlock = element(0xa0, concat(
      element(0xa1, blockPayload(1, 0, 0, Uint8Array.of(0x11, 0x22))),
      uintElement(0x9b, 40),
    ))
  } else if (lacing === 'fixed') {
    videoBlock = simpleBlock(1, 0, 0x84, Uint8Array.of(1, 0x11, 0x12, 0x21, 0x22))
  } else if (lacing === 'xiph') {
    videoBlock = simpleBlock(1, 0, 0x82, Uint8Array.of(1, 2, 0x11, 0x12, 0x21, 0x22))
  } else if (lacing === 'ebml') {
    videoBlock = simpleBlock(1, 0, 0x86, Uint8Array.of(1, 0x82, 0x11, 0x12, 0x21, 0x22))
  } else {
    videoBlock = simpleBlock(1, 0, options.videoInterFrame === true ? 0x00 : 0x80, options.videoPayload ?? Uint8Array.of(0x11, 0x22))
  }
  const clusterPayload = concat(
    uintElement(0xe7, 0),
    videoBlock,
    simpleBlock(2, 0, 0x80, Uint8Array.of(0x33)),
  )
  const cluster = element(0x1f43b675, clusterPayload, options.unknownCluster === true)
  const cues = options.cues === false
    ? new Uint8Array()
    : element(0x1c53bb6b, cuePoint(info.byteLength + tracks.byteLength))
  const segment = element(0x18538067, concat(info, tracks, cluster, cues), options.unknownSegment === true)
  return concat(ebmlHeader, segment)
}

export function createInvalidEbmlVarintFixture(): Uint8Array {
  return concat(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0), new Uint8Array(16))
}
