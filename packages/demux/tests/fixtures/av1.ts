/**
 * Builds an `av1C` record. Unlike VP9 there is no bitstream to walk: the box packs `seq_profile`
 * and `seq_level_idx` into its second byte and the tier plus the bit-depth flags into its third, so
 * the fixture only has to lay those bit fields out the way the spec orders them. The low bits of
 * the third byte carry the chroma subsampling a 4:2:0 stream declares, matching what FFmpeg writes.
 */
export interface Av1COptions {
  marker?: number
  version?: number
  profile?: number
  level?: number
  tier?: number
  highBitDepth?: boolean
  twelveBit?: boolean
}

export function createAv1C(options: Av1COptions = {}): Uint8Array {
  const marker = options.marker ?? 1
  const version = options.version ?? 1
  const profile = options.profile ?? 0
  const level = options.level ?? 0
  const tier = options.tier ?? 0
  const highBitDepth = options.highBitDepth === true ? 1 : 0
  const twelveBit = options.twelveBit === true ? 1 : 0
  return Uint8Array.of(
    ((marker & 1) << 7) | (version & 0x7f),
    ((profile & 0x07) << 5) | (level & 0x1f),
    (tier << 7) | (highBitDepth << 6) | (twelveBit << 5) | 0x0c,
    0,
  )
}
