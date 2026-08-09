import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCodes, type DemuxPacket, type MediaDescriptor } from '@mx-player-max/types'
import { FakeVideo } from './fake-video'

const demux = vi.hoisted(() => ({
  loaderClose: vi.fn(),
  demuxerClose: vi.fn(),
  next: vi.fn<() => Promise<DemuxPacket[]>>(),
}))

vi.mock('@mx-player-max/demux', () => ({
  createRangeLoader: () => ({ close: demux.loaderClose }),
  probeContainer: async () => ({ demuxer: { next: demux.next, close: demux.demuxerClose } }),
}))

import { CoreSubtitleController } from '../src/subtitles'

const media: MediaDescriptor = {
  container: 'matroska',
  tracks: [{ id: 7, kind: 'subtitle', codecId: 'S_TEXT/UTF8' }],
  duration: 3_000_000,
  size: 1,
  mimeType: 'video/x-matroska',
}

function packet(timestamp: number): DemuxPacket {
  return { trackId: 7, kind: 'subtitle', timestamp, duration: 1_000_000, keyframe: false, data: new Uint8Array() }
}

describe('Core embedded subtitle packet budget', () => {
  beforeEach(() => {
    demux.loaderClose.mockClear()
    demux.demuxerClose.mockClear()
    demux.next.mockReset()
  })

  it('stops collecting zero-byte packets at the parser cue/diagnostic budget', async () => {
    demux.next.mockResolvedValueOnce([packet(0), packet(1_000_000), packet(2_000_000)])
    const video = new FakeVideo()
    const controller = new CoreSubtitleController({
      source: { kind: 'file', file: new Blob(['media']) as File },
      media,
      target: { video: video as unknown as HTMLVideoElement, owned: false, container: null, target: video as unknown as HTMLElement },
      surface: video as unknown as HTMLVideoElement,
      rendererKind: null,
      subtitleOptions: { enabled: false, parserLimits: { maxCues: 1, maxDiagnostics: 1 } },
      onEvent: () => {},
    })

    await expect(controller.selectTrack('embedded-7')).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_SOURCE_TOO_LARGE })
    expect(demux.next).toHaveBeenCalledOnce()
    expect(demux.demuxerClose).toHaveBeenCalledOnce()
    expect(demux.loaderClose).toHaveBeenCalledOnce()
    controller.close()
  })

  it('aborts a pending embedded Demux read when selection changes epoch', async () => {
    demux.next.mockImplementationOnce(() => new Promise<DemuxPacket[]>(() => {}))
    const video = new FakeVideo()
    const controller = new CoreSubtitleController({
      source: { kind: 'file', file: new Blob(['media']) as File },
      media,
      target: { video: video as unknown as HTMLVideoElement, owned: false, container: null, target: video as unknown as HTMLElement },
      surface: video as unknown as HTMLVideoElement,
      rendererKind: null,
      subtitleOptions: { enabled: false },
      onEvent: () => {},
    })

    const pending = controller.selectTrack('embedded-7')
    await vi.waitFor(() => expect(demux.next).toHaveBeenCalledOnce())
    await controller.selectTrack(null)
    await expect(pending).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_ABORTED })
    expect(demux.demuxerClose).toHaveBeenCalledOnce()
    expect(demux.loaderClose).toHaveBeenCalledOnce()
    controller.close()
  })

  it('accepts exactly the configured number of non-empty packet batches', async () => {
    demux.next.mockResolvedValueOnce([{
      ...packet(0),
      data: new TextEncoder().encode('hello'),
    }]).mockResolvedValueOnce([])
    const video = new FakeVideo()
    const controller = new CoreSubtitleController({
      source: { kind: 'file', file: new Blob(['media']) as File },
      media,
      target: { video: video as unknown as HTMLVideoElement, owned: false, container: null, target: video as unknown as HTMLElement },
      surface: video as unknown as HTMLVideoElement,
      rendererKind: null,
      subtitleOptions: { enabled: false, sourceLimits: { maxPacketBatches: 1 } },
      onEvent: () => {},
    })

    await expect(controller.selectTrack('embedded-7')).resolves.toBeUndefined()
    expect(demux.next).toHaveBeenCalledTimes(2)
    controller.close()
  })
})
