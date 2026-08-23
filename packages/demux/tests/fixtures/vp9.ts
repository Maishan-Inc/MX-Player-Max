/**
 * Builds VP9 uncompressed frame headers bit by bit. The adapter reads profile and bit depth out of
 * this header, so the fixture has to lay the bits out exactly as the bitstream spec orders them
 * rather than hand back a recorded blob.
 */
class BitWriter {
  readonly #bits: number[] = []

  write(value: number, count: number): this {
    for (let index = count - 1; index >= 0; index -= 1) this.#bits.push((value >>> index) & 1)
    return this
  }

  bytes(): Uint8Array {
    const output = new Uint8Array(Math.ceil(this.#bits.length / 8))
    for (let index = 0; index < this.#bits.length; index += 1) {
      if (this.#bits[index] === 1) output[index >> 3] = (output[index >> 3] ?? 0) | (0x80 >> (index & 7))
    }
    return output
  }
}

export interface Vp9KeyframeOptions {
  profile?: 0 | 1 | 2 | 3
  twelveBit?: boolean
  width?: number
  height?: number
  /** Drops the key-frame flag, which must leave the codec string unrefined. */
  interFrame?: boolean
  showExisting?: boolean
  syncCode?: readonly number[]
}

export function createVp9Keyframe(options: Vp9KeyframeOptions = {}): Uint8Array {
  const profile = options.profile ?? 0
  const writer = new BitWriter()
  writer.write(2, 2)
  writer.write(profile & 1, 1)
  writer.write((profile >> 1) & 1, 1)
  if (profile === 3) writer.write(0, 1)
  writer.write(options.showExisting === true ? 1 : 0, 1)
  if (options.showExisting === true) return writer.write(0, 3).bytes()
  writer.write(options.interFrame === true ? 1 : 0, 1)
  writer.write(1, 1)
  writer.write(0, 1)
  for (const byte of options.syncCode ?? [0x49, 0x83, 0x42]) writer.write(byte, 8)
  if (profile >= 2) writer.write(options.twelveBit === true ? 1 : 0, 1)
  writer.write(2, 3)
  writer.write(0, 1)
  if (profile === 1 || profile === 3) writer.write(1, 1).write(1, 1).write(0, 1)
  writer.write((options.width ?? 320) - 1, 16)
  writer.write((options.height ?? 180) - 1, 16)
  return writer.write(0, 1).bytes()
}

/** A version-1 `vpcC` payload, including the FullBox version and flags the box header carries. */
export function createVpcC(options: { version?: number; profile?: number; level?: number; bitDepth?: number } = {}): Uint8Array {
  const bitDepth = options.bitDepth ?? 8
  return Uint8Array.of(
    options.version ?? 1, 0, 0, 0,
    options.profile ?? 0,
    options.level ?? 31,
    (bitDepth << 4) | (1 << 1),
    1, 1, 1, 0, 0,
  )
}
