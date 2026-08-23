import { describe, expect, it } from 'vitest'
import { FileRangeLoader, probeContainer } from '../src/index'
import { parseVp9KeyframeHeader, vp9CodecString, vp9Level } from '../src/containers/vp9'
import { createEbmlFixture } from './fixtures/ebml'
import { createMp4Fixture } from './fixtures/mp4'
import { createVp9Keyframe, createVpcC } from './fixtures/vp9'

function loaderFor(bytes: Uint8Array, name = 'fixture.webm'): FileRangeLoader {
  return new FileRangeLoader(new File([bytes], name))
}

describe('VP9 uncompressed header', () => {
  it('reads the profile, bit depth and frame size of a keyframe', () => {
    expect(parseVp9KeyframeHeader(createVp9Keyframe())).toEqual({ profile: 0, bitDepth: 8, width: 320, height: 180 })
    expect(parseVp9KeyframeHeader(createVp9Keyframe({ profile: 2, width: 1_920, height: 1_080 })))
      .toEqual({ profile: 2, bitDepth: 10, width: 1_920, height: 1_080 })
    expect(parseVp9KeyframeHeader(createVp9Keyframe({ profile: 2, twelveBit: true })))
      .toMatchObject({ profile: 2, bitDepth: 12 })
    expect(parseVp9KeyframeHeader(createVp9Keyframe({ profile: 1 }))).toMatchObject({ profile: 1, bitDepth: 8 })
    expect(parseVp9KeyframeHeader(createVp9Keyframe({ profile: 3 }))).toMatchObject({ profile: 3, bitDepth: 10 })
  })

  /** Anything that is not a readable keyframe must fall back to the bare codec id, never a guess. */
  it.each([
    ['an inter frame', createVp9Keyframe({ interFrame: true })],
    ['a show_existing_frame frame', createVp9Keyframe({ showExisting: true })],
    ['a wrong frame sync code', createVp9Keyframe({ syncCode: [0x49, 0x83, 0x41] })],
    ['a truncated header', createVp9Keyframe().slice(0, 5)],
    ['an empty payload', new Uint8Array()],
    ['a frame marker that is not 2', Uint8Array.of(0x02, 0x49, 0x83, 0x42, 0, 0, 0, 0, 0, 0)],
  ])('rejects %s', (_label, data) => {
    expect(parseVp9KeyframeHeader(data)).toBeNull()
  })

  it('picks the lowest level the frame size and rate allow', () => {
    expect(vp9Level(256, 144, 15)).toBe('10')
    expect(vp9Level(256, 144, 30)).toBe('11')
    expect(vp9Level(320, 180, 30)).toBe('11')
    expect(vp9Level(1_920, 1_080, 30)).toBe('40')
    expect(vp9Level(1_920, 1_080, 60)).toBe('41')
    expect(vp9Level(3_840, 2_160, 60)).toBe('51')
    expect(vp9Level(65_536, 65_536, 120)).toBe('62')
  })

  /** Without a declared frame rate only the picture-size limit applies, so the level can be low. */
  it('falls back to the picture-size limit when no frame rate is known', () => {
    expect(vp9Level(1_920, 1_080, 120)).toBe('50')
    expect(vp9Level(1_920, 1_080)).toBe('40')
  })

  it('formats the codec string with two digits per field', () => {
    expect(vp9CodecString({ profile: 0, bitDepth: 8, width: 320, height: 180 }, 30)).toBe('vp09.00.11.08')
    expect(vp9CodecString({ profile: 2, bitDepth: 10, width: 1_920, height: 1_080 }, 30)).toBe('vp09.02.40.10')
  })
})

describe('container VP9 codec strings', () => {
  /**
   * WebM and Matroska give a VP9 track no CodecPrivate, so a bare `vp09` was all the metadata could
   * produce — and neither WebCodecs nor `canPlayType` accepts it. The adapter now refines it from
   * the first keyframe of the first Cluster.
   */
  it.each([
    [0, undefined, 'vp09.00.11.08'],
    [2, undefined, 'vp09.02.11.10'],
    [2, true, 'vp09.02.11.12'],
  ] as const)('refines a WebM VP9 profile %s track from its keyframe', async (profile, twelveBit, expected) => {
    const fixture = createEbmlFixture({
      docType: 'webm',
      videoCodecId: 'V_VP9',
      videoPayload: createVp9Keyframe({ profile, ...(twelveBit === undefined ? {} : { twelveBit }) }),
    })
    const selection = await probeContainer(loaderFor(fixture))

    expect(selection.metadata.tracks[0]).toMatchObject({ codecId: 'V_VP9', codec: expected })
    expect(selection.metadata.media.tracks[0]).toMatchObject({ codec: expected })
  })

  it('refines a Matroska VP9 track the same way', async () => {
    const fixture = createEbmlFixture({ videoCodecId: 'V_VP9', videoPayload: createVp9Keyframe() })
    const selection = await probeContainer(loaderFor(fixture, 'fixture.mkv'))

    expect(selection.metadata.container).toBe('matroska')
    expect(selection.metadata.tracks[0]).toMatchObject({ codec: 'vp09.00.11.08' })
  })

  it.each([
    ['the first video block is not a keyframe', { videoInterFrame: true, videoPayload: createVp9Keyframe() }],
    ['the frame payload is not a VP9 header', { videoPayload: Uint8Array.of(0x11, 0x22) }],
  ])('keeps the bare codec id when %s', async (_label, overrides) => {
    const selection = await probeContainer(loaderFor(createEbmlFixture({ docType: 'webm', videoCodecId: 'V_VP9', ...overrides })))

    expect(selection.metadata.tracks[0]).toMatchObject({ codec: 'vp09' })
    await expect(selection.demuxer.next()).resolves.toHaveLength(2)
  })

  it('reads profile, level and bit depth straight out of an MP4 vpcC box', async () => {
    const fixture = createMp4Fixture({ videoSampleEntry: { type: 'vp09', configType: 'vpcC', config: createVpcC({ profile: 2, level: 41, bitDepth: 10 }) } })
    const selection = await probeContainer(loaderFor(fixture, 'fixture.mp4'))

    expect(selection.metadata.tracks[0]).toMatchObject({ codecId: 'vp09', codec: 'vp09.02.41.10' })
  })

  it.each([
    ['the vpcC version is not 1', createVpcC({ version: 0 })],
    ['the declared bit depth is not 8, 10 or 12', createVpcC({ bitDepth: 9 })],
    ['the declared level is below the lowest one', createVpcC({ level: 1 })],
  ])('keeps a bare MP4 vp09 when %s', async (_label, config) => {
    const fixture = createMp4Fixture({ videoSampleEntry: { type: 'vp09', configType: 'vpcC', config } })
    const selection = await probeContainer(loaderFor(fixture, 'fixture.mp4'))

    expect(selection.metadata.tracks[0]).toMatchObject({ codecId: 'vp09', codec: 'vp09' })
  })
})
