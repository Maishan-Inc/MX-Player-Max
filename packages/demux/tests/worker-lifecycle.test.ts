import { describe, expect, it, vi } from 'vitest'
import type { DemuxPacket, MediaDescriptor } from '@mx-player-max/types'
import {
  DemuxWorkerController,
  type ContainerAdapter,
  type ContainerProbeResult,
  type ContainerSelection,
  type Demuxer,
  type DemuxWorkerResponse,
  type RangeLoader,
} from '../src/index'
import { createMp4Fixture } from './fixtures/mp4'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

class TestPort {
  readonly messages: DemuxWorkerResponse[] = []
  readonly transfers: Transferable[][] = []

  postMessage(message: DemuxWorkerResponse, transfer: Transferable[] = []): void {
    this.messages.push(message)
    this.transfers.push(transfer)
  }
}

function createFakeSelection(demuxer: Demuxer): ContainerSelection {
  const media: MediaDescriptor = {
    container: 'mp4',
    tracks: [{ id: 1, kind: 'video', codecId: 'avc1', codec: 'avc1' }],
    duration: 1_000_000,
    size: 4,
    mimeType: 'video/mp4',
  }
  const metadata: ContainerProbeResult = {
    container: 'mp4',
    media,
    tracks: media.tracks,
    duration: media.duration,
    size: media.size,
    hasSeekIndex: true,
  }
  const adapter: ContainerAdapter = {
    id: 'fake',
    name: 'Fake',
    canProbe: () => true,
    probe: async () => metadata,
    createDemuxer: () => demuxer,
  }
  return { adapter, metadata, demuxer }
}

function fakeLoader(close = vi.fn()): RangeLoader {
  return {
    read: async () => { throw new Error('unexpected fake range read') },
    close,
  }
}

describe('DemuxWorkerController', () => {
  it('runs start, read, and close with serializable responses', async () => {
    const port = new TestPort()
    const controller = new DemuxWorkerController(port)
    const file = new File([createMp4Fixture()], 'fixture.mp4')

    await controller.handle({ command: 'start', sessionId: 'session', epoch: 0, requestId: 'start', source: { kind: 'file', file } })
    await controller.handle({ command: 'read', sessionId: 'session', epoch: 0, requestId: 'read' })
    await controller.handle({ command: 'close', sessionId: 'session', epoch: 0, requestId: 'close' })
    await controller.handle({ command: 'read', sessionId: 'session', epoch: 0, requestId: 'late-read' })

    expect(port.messages.map((message) => message.type)).toEqual(['probe', 'packets', 'closed'])
    const packetResponse = port.messages[1]
    expect(packetResponse?.type).toBe('packets')
    if (packetResponse?.type === 'packets') expect(packetResponse.packets).toHaveLength(2)
    expect(port.transfers[1]).toHaveLength(2)
  })

  it('closes a pending start and suppresses its late probe', async () => {
    const port = new TestPort()
    const selectionDeferred = deferred<ContainerSelection>()
    const closeLoader = vi.fn()
    const closeDemuxer = vi.fn()
    const demuxer: Demuxer = {
      probe: async () => ({ container: 'mp4', tracks: [], duration: null, size: null, mimeType: null }),
      next: async () => [],
      seek: async () => undefined,
      close: closeDemuxer,
    }
    const controller = new DemuxWorkerController(port, {
      createLoader: () => fakeLoader(closeLoader),
      probe: async () => selectionDeferred.promise,
    })
    const start = controller.handle({
      command: 'start',
      sessionId: 'session',
      epoch: 0,
      requestId: 'start',
      source: { kind: 'file', file: new File([Uint8Array.of(1)], 'fake') },
    })
    await Promise.resolve()

    await controller.handle({ command: 'close', sessionId: 'session', epoch: 1, requestId: 'close' })
    selectionDeferred.resolve(createFakeSelection(demuxer))
    await start

    expect(closeLoader).toHaveBeenCalledOnce()
    expect(closeDemuxer).toHaveBeenCalledOnce()
    expect(port.messages.map((message) => message.type)).toEqual(['closed'])
  })

  it('drops an old-epoch packet result before applying seek', async () => {
    const port = new TestPort()
    const nextDeferred = deferred<DemuxPacket[]>()
    const seek = vi.fn(async () => undefined)
    const next = vi.fn(async () => nextDeferred.promise)
    const demuxer: Demuxer = {
      probe: async () => ({ container: 'mp4', tracks: [], duration: null, size: null, mimeType: null }),
      next,
      seek,
      close: vi.fn(),
    }
    const controller = new DemuxWorkerController(port, {
      createLoader: () => fakeLoader(),
      probe: async () => createFakeSelection(demuxer),
    })
    await controller.handle({
      command: 'start',
      sessionId: 'session',
      epoch: 0,
      requestId: 'start',
      source: { kind: 'file', file: new File([Uint8Array.of(1)], 'fake') },
    })
    const read = controller.handle({ command: 'read', sessionId: 'session', epoch: 0, requestId: 'read' })
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce())
    const seekOperation = controller.handle({ command: 'seek', sessionId: 'session', epoch: 1, requestId: 'seek', time: 500_000 })
    nextDeferred.resolve([{
      trackId: 1,
      kind: 'video',
      timestamp: 0,
      duration: 1_000,
      keyframe: true,
      data: Uint8Array.of(1),
    }])

    await Promise.all([read, seekOperation])

    expect(seek).toHaveBeenCalledWith(500_000)
    expect(port.messages.map((message) => message.type)).toEqual(['probe', 'seeked'])
  })

  it('aborts a pending read on close and emits no late packet', async () => {
    const port = new TestPort()
    const nextDeferred = deferred<DemuxPacket[]>()
    const closeLoader = vi.fn()
    const closeDemuxer = vi.fn()
    const next = vi.fn(async () => nextDeferred.promise)
    const demuxer: Demuxer = {
      probe: async () => ({ container: 'mp4', tracks: [], duration: null, size: null, mimeType: null }),
      next,
      seek: async () => undefined,
      close: closeDemuxer,
    }
    const controller = new DemuxWorkerController(port, {
      createLoader: () => fakeLoader(closeLoader),
      probe: async () => createFakeSelection(demuxer),
    })
    await controller.handle({
      command: 'start',
      sessionId: 'session',
      epoch: 0,
      requestId: 'start',
      source: { kind: 'file', file: new File([Uint8Array.of(1)], 'fake') },
    })
    const read = controller.handle({ command: 'read', sessionId: 'session', epoch: 0, requestId: 'read' })
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce())

    await controller.handle({ command: 'close', sessionId: 'session', epoch: 1, requestId: 'close' })
    nextDeferred.resolve([])
    await read

    expect(closeLoader).toHaveBeenCalledOnce()
    expect(closeDemuxer).toHaveBeenCalledOnce()
    expect(port.messages.map((message) => message.type)).toEqual(['probe', 'closed'])
  })
})

