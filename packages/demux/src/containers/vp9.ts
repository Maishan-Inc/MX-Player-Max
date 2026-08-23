/**
 * VP9 carries its profile and bit depth in the frame header rather than in container metadata, and
 * WebM/Matroska give a VP9 track no CodecPrivate at all. A bare `vp09` is rejected by
 * `VideoDecoder.isConfigSupported` and by `HTMLMediaElement.canPlayType`, so the only way to route
 * VP9 anywhere other than a lenient native player is to read the first keyframe's uncompressed
 * header and assemble an RFC-shaped `vp09.PP.LL.DD` string.
 */

/** Follows the uncompressed-header flags of every VP9 keyframe. */
const FRAME_SYNC_CODE = [0x49, 0x83, 0x42] as const
const COLOR_SPACE_SRGB = 7

export interface Vp9FrameHeader {
  /** 0-3; profiles 1 and 3 allow non-4:2:0 chroma, profiles 2 and 3 allow 10- and 12-bit. */
  readonly profile: number
  readonly bitDepth: 8 | 10 | 12
  readonly width: number
  readonly height: number
}

/**
 * Level limits from the VP9 level table. Only the two resolution-derived columns are listed: the
 * bitrate and CPB columns cannot be checked at probe time, so the level below is the lowest one
 * the frame size and frame rate permit rather than a full conformance verdict.
 */
interface Vp9LevelLimit {
  readonly id: string
  readonly maxLumaSampleRate: number
  readonly maxLumaPictureSize: number
}

const VP9_LEVELS: readonly Vp9LevelLimit[] = [
  { id: '10', maxLumaSampleRate: 829_440, maxLumaPictureSize: 36_864 },
  { id: '11', maxLumaSampleRate: 2_764_800, maxLumaPictureSize: 73_728 },
  { id: '20', maxLumaSampleRate: 4_608_000, maxLumaPictureSize: 122_880 },
  { id: '21', maxLumaSampleRate: 9_216_000, maxLumaPictureSize: 245_760 },
  { id: '30', maxLumaSampleRate: 20_736_000, maxLumaPictureSize: 552_960 },
  { id: '31', maxLumaSampleRate: 36_864_000, maxLumaPictureSize: 983_040 },
  { id: '40', maxLumaSampleRate: 83_558_400, maxLumaPictureSize: 2_228_224 },
  { id: '41', maxLumaSampleRate: 160_432_128, maxLumaPictureSize: 2_228_224 },
  { id: '50', maxLumaSampleRate: 311_951_360, maxLumaPictureSize: 8_912_896 },
  { id: '51', maxLumaSampleRate: 588_251_136, maxLumaPictureSize: 8_912_896 },
  { id: '52', maxLumaSampleRate: 1_176_502_272, maxLumaPictureSize: 8_912_896 },
  { id: '60', maxLumaSampleRate: 1_176_502_272, maxLumaPictureSize: 35_651_584 },
  { id: '61', maxLumaSampleRate: 2_353_004_544, maxLumaPictureSize: 35_651_584 },
  { id: '62', maxLumaSampleRate: 4_706_009_088, maxLumaPictureSize: 35_651_584 },
]

class BitReader {
  readonly #data: Uint8Array
  #bit = 0
  #overflowed = false

  constructor(data: Uint8Array) { this.#data = data }

  get overflowed(): boolean { return this.#overflowed }

  read(bits: number): number {
    let value = 0
    for (let index = 0; index < bits; index += 1) {
      const byte = this.#data[this.#bit >> 3]
      if (byte === undefined) { this.#overflowed = true; return 0 }
      value = value * 2 + ((byte >> (7 - (this.#bit & 7))) & 1)
      this.#bit += 1
    }
    return value
  }
}

/**
 * Reads the uncompressed header of a VP9 keyframe. Returns `null` for anything else — an inter
 * frame, a `show_existing_frame` frame, a truncated payload, or a reserved-bit violation — because
 * callers must fall back to the bare codec id rather than publish a guessed string.
 */
export function parseVp9KeyframeHeader(data: Uint8Array): Vp9FrameHeader | null {
  const reader = new BitReader(data)
  if (reader.read(2) !== 2) return null
  const profileLowBit = reader.read(1)
  const profileHighBit = reader.read(1)
  const profile = profileHighBit * 2 + profileLowBit
  if (profile === 3 && reader.read(1) !== 0) return null
  if (reader.read(1) !== 0) return null
  if (reader.read(1) !== 0) return null
  reader.read(1)
  reader.read(1)
  for (const byte of FRAME_SYNC_CODE) if (reader.read(8) !== byte) return null
  const bitDepth = profile >= 2 ? (reader.read(1) === 1 ? 12 : 10) : 8
  const colorSpace = reader.read(3)
  if (colorSpace === COLOR_SPACE_SRGB) {
    if (profile !== 1 && profile !== 3) return null
    if (reader.read(1) !== 0) return null
  } else {
    reader.read(1)
    if (profile === 1 || profile === 3) {
      reader.read(1)
      reader.read(1)
      if (reader.read(1) !== 0) return null
    }
  }
  const width = reader.read(16) + 1
  const height = reader.read(16) + 1
  if (reader.overflowed) return null
  return { profile, bitDepth, width, height }
}

/**
 * The lowest level whose luma sample rate and picture size cover the stream. `frameRate` is
 * optional because a container may not declare one; the sample-rate constraint is then skipped,
 * which can under-report the level for a high frame rate.
 */
export function vp9Level(width: number, height: number, frameRate?: number): string {
  const pictureSize = width * height
  const sampleRate = frameRate !== undefined && Number.isFinite(frameRate) && frameRate > 0 ? pictureSize * frameRate : 0
  const level = VP9_LEVELS.find((entry) => entry.maxLumaPictureSize >= pictureSize && entry.maxLumaSampleRate >= sampleRate)
  return level?.id ?? VP9_LEVELS[VP9_LEVELS.length - 1]?.id ?? '62'
}

/** Assembles `vp09.PP.LL.DD`; the remaining colour fields are optional and left at their defaults. */
export function vp9CodecString(header: Vp9FrameHeader, frameRate?: number): string {
  const profile = String(header.profile).padStart(2, '0')
  const bitDepth = String(header.bitDepth).padStart(2, '0')
  return `vp09.${profile}.${vp9Level(header.width, header.height, frameRate)}.${bitDepth}`
}
