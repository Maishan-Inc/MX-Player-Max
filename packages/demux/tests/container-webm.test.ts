import { describe, expect, it } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import {
  DemuxError,
  FileRangeLoader,
  WebMContainerAdapter,
  probeContainer,
} from '../src/index'
import { createEbmlFixture } from './fixtures/ebml'

function loaderFor(bytes: Uint8Array): FileRangeLoader {
  return new FileRangeLoader(new File([bytes], 'fixture.webm'))
}

describe('WebMContainerAdapter', () => {
  it('distinguishes WebM by DocType and maps its base codecs', async () => {
    const selection = await probeContainer(loaderFor(createEbmlFixture({ docType: 'webm' })))

    expect(selection.metadata.container).toBe('webm')
    expect(selection.metadata.media.mimeType).toBe('video/webm')
    expect(selection.metadata.tracks).toMatchObject([
      { codecId: 'V_VP9', codec: 'vp09' },
      { codecId: 'A_OPUS', codec: 'opus' },
    ])
    await expect(selection.demuxer.next()).resolves.toHaveLength(2)
  })

  it.each([
    ['V_VP8', 'vp8', 'A_VORBIS', 'vorbis'],
    ['V_VP9', 'vp09', 'A_OPUS', 'opus'],
    ['V_AV1', 'av01', 'A_OPUS', 'opus'],
  ] as const)('maps %s and %s without confusing container and Codec', async (videoCodecId, videoCodec, audioCodecId, audioCodec) => {
    const selection = await probeContainer(loaderFor(createEbmlFixture({
      docType: 'webm',
      videoCodecId,
      audioCodecId,
    })))

    expect(selection.metadata.tracks[0]).toMatchObject({ codecId: videoCodecId, codec: videoCodec })
    expect(selection.metadata.tracks[1]).toMatchObject({ codecId: audioCodecId, codec: audioCodec })
    expect(selection.metadata.container).toBe('webm')
  })

  it('does not accept a generic Matroska DocType as WebM', async () => {
    const adapter = new WebMContainerAdapter()

    await expect(adapter.probe(loaderFor(createEbmlFixture({ docType: 'matroska' })))).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(DemuxError)
      expect((error as DemuxError).code).toBe(ErrorCodes.CONTAINER_UNSUPPORTED)
      return true
    })
  })
})
