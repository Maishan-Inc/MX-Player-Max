import { describe, expect, it } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import {
  DemuxError,
  FileRangeLoader,
  MatroskaContainerAdapter,
  probeContainer,
} from '../src/index'
import { createEbmlFixture, createInvalidEbmlVarintFixture } from './fixtures/ebml'

function loaderFor(bytes: Uint8Array): FileRangeLoader {
  return new FileRangeLoader(new File([bytes], 'fixture.mkv'))
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    expect(error).toBeInstanceOf(DemuxError)
    expect((error as DemuxError).code).toBe(code)
    return true
  })
}

describe('MatroskaContainerAdapter', () => {
  it('probes tracks, duration, CodecPrivate, packets, and Cues', async () => {
    const loader = loaderFor(createEbmlFixture())
    const selection = await probeContainer(loader)

    expect(selection.metadata.container).toBe('matroska')
    expect(selection.metadata.duration).toBe(2_000_000)
    expect(selection.metadata.hasSeekIndex).toBe(true)
    expect(selection.metadata.tracks).toMatchObject([
      { id: 1, kind: 'video', codecId: 'V_MPEG4/ISO/AVC', codec: 'avc1', width: 320, height: 180 },
      { id: 2, kind: 'audio', codecId: 'A_AAC', codec: 'mp4a.40.2', sampleRate: 48_000, channels: 2 },
    ])
    expect(selection.metadata.tracks[1]?.codecPrivate).toBeInstanceOf(ArrayBuffer)

    const packets = await selection.demuxer.next()

    expect(packets.map((packet) => ({ trackId: packet.trackId, timestamp: packet.timestamp, keyframe: packet.keyframe, data: [...packet.data] }))).toEqual([
      { trackId: 1, timestamp: 0, keyframe: true, data: [0x11, 0x22] },
      { trackId: 2, timestamp: 0, keyframe: true, data: [0x33] },
    ])
  })

  it('uses a bounded forward scan when Cues are absent', async () => {
    const loader = loaderFor(createEbmlFixture({ cues: false }))
    const selection = await probeContainer(loader)
    expect(selection.metadata.hasSeekIndex).toBe(false)

    await selection.demuxer.seek(1_000_000)
    const packets = await selection.demuxer.next()

    expect(packets[0]?.trackId).toBe(1)
    expect(packets[0]?.keyframe).toBe(true)
  })

  it('handles unknown-length Segment and Cluster without looping', async () => {
    const loader = loaderFor(createEbmlFixture({ unknownSegment: true, unknownCluster: true }))
    const selection = await probeContainer(loader)

    expect(selection.metadata.container).toBe('matroska')
    await expect(selection.demuxer.next()).resolves.toHaveLength(2)
  })

  it('splits fixed-laced blocks into individual compressed packets', async () => {
    const loader = loaderFor(createEbmlFixture({ fixedLacing: true }))
    const selection = await probeContainer(loader)
    const packets = await selection.demuxer.next()

    expect(packets.filter((packet) => packet.trackId === 1).map((packet) => [...packet.data])).toEqual([
      [0x11, 0x12],
      [0x21, 0x22],
    ])
  })

  it.each(['xiph', 'ebml'] as const)('splits %s-laced blocks safely', async (lacing) => {
    const selection = await probeContainer(loaderFor(createEbmlFixture({ lacing })))
    const packets = await selection.demuxer.next()

    expect(packets.filter((packet) => packet.trackId === 1).map((packet) => [...packet.data])).toEqual([
      [0x11, 0x12],
      [0x21, 0x22],
    ])
  })

  it('parses BlockGroup/Block duration and keyframe semantics without decoding', async () => {
    const selection = await probeContainer(loaderFor(createEbmlFixture({ blockGroup: true })))
    const packets = await selection.demuxer.next()

    expect(packets[0]).toMatchObject({ trackId: 1, keyframe: true, duration: 40_000 })
    expect([...packets[0]?.data ?? []]).toEqual([0x11, 0x22])
  })

  it('preserves an unknown CodecID without inventing a normalized codec', async () => {
    const selection = await probeContainer(loaderFor(createEbmlFixture({ videoCodecId: 'V_FUTURE/UNKNOWN' })))
    const video = selection.metadata.tracks.find((track) => track.kind === 'video')

    expect(video?.codecId).toBe('V_FUTURE/UNKNOWN')
    expect(video?.codec).toBeUndefined()
  })

  it('maps the Matroska MPEG Layer III CodecID to the WebCodecs mp3 codec', async () => {
    const selection = await probeContainer(loaderFor(createEbmlFixture({ audioCodecId: 'A_MPEG/L3' })))
    expect(selection.metadata.tracks[1]).toMatchObject({ codecId: 'A_MPEG/L3', codec: 'mp3' })
  })

  it('returns stable failures for truncation, bad varints, and track limits', async () => {
    const fixture = createEbmlFixture()
    await expectCode(probeContainer(loaderFor(fixture.slice(0, fixture.byteLength - 2))), ErrorCodes.CONTAINER_TRUNCATED)

    const invalidLoader = loaderFor(createInvalidEbmlVarintFixture())
    await expectCode(new MatroskaContainerAdapter().probe(invalidLoader), ErrorCodes.CONTAINER_INVALID)

    const limitedLoader = loaderFor(createEbmlFixture())
    await expectCode(new MatroskaContainerAdapter({ maxTracks: 1 }).probe(limitedLoader), ErrorCodes.CONTAINER_LIMIT_EXCEEDED)

    const shallowLoader = loaderFor(createEbmlFixture())
    await expectCode(new MatroskaContainerAdapter({ maxNestingDepth: 2 }).probe(shallowLoader), ErrorCodes.CONTAINER_LIMIT_EXCEEDED)
  })
})
