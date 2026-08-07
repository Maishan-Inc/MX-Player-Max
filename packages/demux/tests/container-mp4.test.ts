import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes, type ByteRange, type RangeLoaderOptions, type RangeReadResult } from '@mx-player-max/types'
import {
  DemuxError,
  FileRangeLoader,
  HttpRangeLoader,
  Mp4ContainerAdapter,
  probeContainer,
  type RangeLoader,
} from '../src/index'
import {
  createFragmentedMp4Fixture,
  createInvalidMp4BoxSizeFixture,
  createMp4Fixture,
} from './fixtures/mp4'

function loaderFor(bytes: Uint8Array): FileRangeLoader {
  return new FileRangeLoader(new File([bytes], 'fixture.mp4'))
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    expect(error).toBeInstanceOf(DemuxError)
    expect((error as DemuxError).code).toBe(code)
    return true
  })
}

class RecordingLoader implements RangeLoader {
  readonly ranges: ByteRange[] = []
  readonly #inner: FileRangeLoader

  constructor(bytes: Uint8Array) {
    this.#inner = loaderFor(bytes)
  }

  read(range: ByteRange, options?: RangeLoaderOptions): Promise<RangeReadResult> {
    this.ranges.push({ ...range })
    return this.#inner.read(range, options)
  }

  close(): void {
    this.#inner.close()
  }
}

describe('Mp4ContainerAdapter', () => {
  it('probes faststart metadata and outputs sample packets in decode order with PTS', async () => {
    const loader = loaderFor(createMp4Fixture())
    const selection = await probeContainer(loader)

    expect(selection.metadata.container).toBe('mp4')
    expect(selection.metadata.duration).toBe(2_000_000)
    expect(selection.metadata.hasSeekIndex).toBe(true)
    expect(selection.metadata.tracks[0]).toMatchObject({
      id: 1,
      kind: 'video',
      codecId: 'avc1',
      codec: 'avc1.64001F',
      width: 320,
      height: 180,
      language: 'eng',
    })
    expect(selection.metadata.tracks[0]?.codecPrivate).toBeInstanceOf(ArrayBuffer)

    const packets = await selection.demuxer.next()

    expect(packets.map((packet) => ({ timestamp: packet.timestamp, duration: packet.duration, keyframe: packet.keyframe, data: [...packet.data] }))).toEqual([
      { timestamp: 0, duration: 1_000_000, keyframe: true, data: [0xaa, 0xab] },
      { timestamp: 1_500_000, duration: 1_000_000, keyframe: false, data: [0xba, 0xbb] },
    ])
  })

  it('finds a tail moov without reading the complete mdat during probe', async () => {
    const bytes = createMp4Fixture({ tailMoov: true })
    const loader = new RecordingLoader(bytes)
    const selection = await probeContainer(loader)

    expect(selection.metadata.container).toBe('mp4')
    expect(loader.ranges.some((range) => range.start === 32 && range.endExclusive === 36)).toBe(false)
    const packets = await selection.demuxer.next()
    expect([...packets[0]?.data ?? []]).toEqual([0xaa, 0xab])
  })

  it('supports co64, 64-bit boxes, and a final size=0 mdat', async () => {
    const extended = await probeContainer(loaderFor(createMp4Fixture({ extendedFree: true, co64: true })))
    await expect(extended.demuxer.next()).resolves.toHaveLength(2)

    const sizeZero = await probeContainer(loaderFor(createMp4Fixture({ sizeZeroMdat: true })))
    await expect(sizeZero.demuxer.next()).resolves.toHaveLength(2)
  })

  it('seeks to the preceding sync sample', async () => {
    const selection = await probeContainer(loaderFor(createMp4Fixture()))

    await selection.demuxer.seek(1_900_000)
    const packets = await selection.demuxer.next()

    expect(packets[0]?.timestamp).toBe(0)
    expect(packets[0]?.keyframe).toBe(true)
  })

  it('recognizes fragmented MP4 but does not pretend to implement fragment playback', async () => {
    const selection = await probeContainer(loaderFor(createFragmentedMp4Fixture()))

    expect(selection.metadata.container).toBe('mp4')
    expect(selection.metadata.hasSeekIndex).toBe(false)
    await expectCode(selection.demuxer.next(), ErrorCodes.CONTAINER_UNSUPPORTED)
  })

  it('returns stable errors for bad size, truncation, overflow, and packet limits', async () => {
    await expectCode(probeContainer(loaderFor(createInvalidMp4BoxSizeFixture())), ErrorCodes.CONTAINER_INVALID)

    const fixture = createMp4Fixture()
    await expectCode(probeContainer(loaderFor(fixture.slice(0, fixture.byteLength - 1))), ErrorCodes.CONTAINER_TRUNCATED)

    await expectCode(
      new Mp4ContainerAdapter().probe(loaderFor(createMp4Fixture({ co64: true, overflowOffset: true }))),
      ErrorCodes.CONTAINER_INVALID,
    )
    await expectCode(
      new Mp4ContainerAdapter({ maxPacketBytes: 1 }).probe(loaderFor(createMp4Fixture())),
      ErrorCodes.CONTAINER_LIMIT_EXCEEDED,
    )
  })

  it('produces identical metadata and packets from File and mocked HTTP Range', async () => {
    const bytes = createMp4Fixture({ tailMoov: true, co64: true })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const value = new Headers(init?.headers).get('Range')
      const match = /^bytes=([0-9]+)-([0-9]+)$/.exec(value ?? '')
      const start = Number(match?.[1])
      const endInclusive = Number(match?.[2])
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endInclusive)) throw new Error('invalid test Range')
      const body = bytes.slice(start, endInclusive + 1)
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${endInclusive}/${bytes.byteLength}`,
          'Content-Length': String(body.byteLength),
          ETag: '"fixture"',
        },
      })
    })
    const fileSelection = await probeContainer(loaderFor(bytes))
    const httpSelection = await probeContainer(new HttpRangeLoader('https://media.test/fixture.mp4', { fetch: fetchMock }))

    expect(httpSelection.metadata).toEqual(fileSelection.metadata)
    expect(await httpSelection.demuxer.next()).toEqual(await fileSelection.demuxer.next())
    expect(fetchMock).toHaveBeenCalled()
  })
})
