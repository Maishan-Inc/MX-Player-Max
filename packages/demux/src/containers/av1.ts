/**
 * AV1 carries its profile, level, tier and bit depth in the `av1C` configuration record, which MP4
 * stores as the `av1C` sample-entry child and Matroska as the track's CodecPrivate. A bare `av01`
 * is rejected by `VideoDecoder.isConfigSupported` and by `canPlayType` in both Chromium and Firefox,
 * so both containers need the record read into an RFC 6381 `av01.P.LLT.DD` string — one shared
 * reader, because the bytes are the same in both places.
 */

/**
 * Reads the profile/level/tier/bit-depth an `av1C` (AV1CodecConfigurationRecord) layout carries.
 *
 * `av1C` begins with a marker/version byte, then packs `seq_profile` and `seq_level_idx` into the
 * second byte and the tier plus bit-depth flags into the third. That is every field an
 * `av01.P.LLT.DD` string needs, so it is read straight from the record rather than from the first
 * OBU. A wrong marker or version keeps the bare `av01`, exactly as a VP9 track without a readable
 * keyframe does.
 */
export function av1CodecString(privateData: Uint8Array | undefined): string | null {
  if (privateData === undefined || privateData.byteLength < 4) return null
  if ((privateData[0] ?? 0) !== 0x81) return null
  const profile = ((privateData[1] ?? 0) >> 5) & 0x07
  const level = (privateData[1] ?? 0) & 0x1f
  const tier = ((privateData[2] ?? 0) >> 7) & 0x01
  const highBitDepth = ((privateData[2] ?? 0) >> 6) & 0x01
  const twelveBit = ((privateData[2] ?? 0) >> 5) & 0x01
  if (profile > 2) return null
  // `twelve_bit` only carries meaning for a high-bit-depth profile 2 stream; everywhere else the
  // spec leaves it zero, so reading it unconditionally would invent a 12-bit stream from a bad byte.
  const bitDepth = profile === 2 && highBitDepth === 1 ? (twelveBit === 1 ? 12 : 10) : highBitDepth === 1 ? 10 : 8
  return `${profile}.${String(level).padStart(2, '0')}${tier === 1 ? 'H' : 'M'}.${String(bitDepth).padStart(2, '0')}`
}
