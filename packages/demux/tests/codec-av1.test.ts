import { describe, expect, it } from 'vitest'
import { FileRangeLoader, probeContainer } from '../src/index'
import { createAv1C, type Av1COptions } from './fixtures/av1'
import { createMp4Fixture } from './fixtures/mp4'

async function av1Codec(config: Uint8Array): Promise<string | undefined> {
  const fixture = createMp4Fixture({ videoSampleEntry: { type: 'av01', configType: 'av1C', config } })
  const selection = await probeContainer(new FileRangeLoader(new File([fixture], 'fixture.mp4')))
  return selection.metadata.tracks[0]?.codec
}

describe('MP4 AV1 codec strings', () => {
  /**
   * A bare `av01` is rejected by `VideoDecoder.isConfigSupported` and by `canPlayType` in both
   * Chromium and Firefox, so an AV1 track had no route at all — the same trap VP9 fell into — until
   * the string carried profile, level, tier and bit depth. `av1C` holds all four outright.
   */
  it.each([
    ['profile 0 at 8 bits', {}, 'av01.0.00M.08'],
    ['a level that needs two digits', { level: 4 }, 'av01.0.04M.08'],
    ['the high tier', { tier: 1, level: 8 }, 'av01.0.08H.08'],
    ['profile 1', { profile: 1 }, 'av01.1.00M.08'],
    ['10-bit profile 0', { highBitDepth: true }, 'av01.0.00M.10'],
    ['10-bit profile 2', { profile: 2, highBitDepth: true }, 'av01.2.00M.10'],
    ['12-bit profile 2', { profile: 2, highBitDepth: true, twelveBit: true }, 'av01.2.00M.12'],
  ] as const)('derives %s', async (_label, options: Av1COptions, expected) => {
    await expect(av1Codec(createAv1C(options))).resolves.toBe(expected)
  })

  /**
   * The spec only gives `twelve_bit` a meaning for a high-bit-depth profile 2 stream and leaves it
   * zero everywhere else, so reading it unconditionally would report a 12-bit stream from one stray
   * bit and hand WebCodecs a configuration the file cannot back.
   */
  it('ignores twelve_bit outside high-bit-depth profile 2', async () => {
    await expect(av1Codec(createAv1C({ twelveBit: true }))).resolves.toBe('av01.0.00M.08')
    await expect(av1Codec(createAv1C({ profile: 2, twelveBit: true }))).resolves.toBe('av01.2.00M.08')
  })

  /** Anything unreadable keeps the bare sample entry type rather than a fabricated string. */
  it.each([
    ['the marker bit is clear', createAv1C({ marker: 0 })],
    ['the version is not 1', createAv1C({ version: 0 })],
    ['the profile is reserved', createAv1C({ profile: 3 })],
    ['the record is truncated', createAv1C().slice(0, 3)],
  ])('keeps a bare av01 when %s', async (_label, config) => {
    await expect(av1Codec(config)).resolves.toBe('av01')
  })
})
