import { describe, expect, it, vi } from 'vitest'
import type { DemuxWorkerRequest, DemuxWorkerResponse } from '@mx-player-max/demux'
import { ErrorCodes } from '@mx-player-max/types'
import { DemuxWorkerSession, type DemuxWorkerTransport } from '../src/index'
import { createMedia } from './custom-fakes'

class FakeWorker implements DemuxWorkerTransport {
  readonly requests: DemuxWorkerRequest[] = []
  readonly terminate = vi.fn()
  message: ((event: MessageEvent<DemuxWorkerResponse> | Event) => void) | null = null
  error: ((event: MessageEvent<DemuxWorkerResponse> | Event) => void) | null = null
  postMessage(message: DemuxWorkerRequest): void { this.requests.push(message) }
  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent<DemuxWorkerResponse> | Event) => void): void {
    if (type === 'message') this.message = listener
    else this.error = listener
  }
  removeEventListener(type: 'message' | 'error'): void {
    if (type === 'message') this.message = null
    else this.error = null
  }
  respond(response: DemuxWorkerResponse): void { this.message?.({ data: response } as MessageEvent<DemuxWorkerResponse>) }
  fail(): void { this.error?.(new Event('error')) }
}

describe('DemuxWorkerSession', () => {
  it('uses unique request IDs and requires session/epoch/requestId matches', async () => {
    const worker = new FakeWorker()
    const session = new DemuxWorkerSession({ operationTimeoutMs: 1000, transportFactory: () => worker, sessionId: 'session' })
    const started = session.start({ kind: 'file', file: new Blob(['x']) as File }, 0)
    const start = worker.requests[0]
    if (!start) throw new Error('missing start')
    const media = createMedia()
    const metadata = { container: media.container, media, tracks: media.tracks, duration: media.duration, size: media.size, hasSeekIndex: true }
    worker.respond({ type: 'probe', sessionId: 'other', epoch: 0, requestId: start.requestId, metadata })
    let settled = false
    void started.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    worker.respond({ type: 'probe', sessionId: 'session', epoch: 0, requestId: start.requestId, metadata })
    await expect(started).resolves.toEqual(metadata)

    const reading = session.read(0)
    const read = worker.requests[1]
    if (!read) throw new Error('missing read')
    expect(read.requestId).not.toBe(start.requestId)
    worker.respond({ type: 'packets', sessionId: 'session', epoch: 0, requestId: read.requestId, packets: [], endOfStream: true })
    await expect(reading).resolves.toMatchObject({ endOfStream: true })
    session.close(1)
  })

  it('aborts old epoch requests and terminates Worker/listeners on close', async () => {
    const worker = new FakeWorker()
    const session = new DemuxWorkerSession({ operationTimeoutMs: 1000, transportFactory: () => worker, sessionId: 'session' })
    const media = createMedia()
    const startPromise = session.start({ kind: 'file', file: new Blob(['x']) as File }, 0)
    const start = worker.requests[0]
    if (!start) throw new Error('missing start')
    worker.respond({ type: 'probe', sessionId: 'session', epoch: 0, requestId: start.requestId, metadata: { container: media.container, media, tracks: media.tracks, duration: media.duration, size: media.size, hasSeekIndex: true } })
    await startPromise
    const pending = session.read(0)
    session.advanceEpoch(1)
    await expect(pending).rejects.toMatchObject({ code: 'WEBCODECS_ABORTED' })
    session.close(2)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.message).toBeNull()
    expect(worker.error).toBeNull()
  })

  it('rejects every pending request when the Worker terminates unexpectedly', async () => {
    const worker = new FakeWorker()
    const session = new DemuxWorkerSession({ operationTimeoutMs: 1000, transportFactory: () => worker, sessionId: 'session' })
    const pending = session.start({ kind: 'file', file: new Blob(['x']) as File }, 0)

    worker.fail()

    await expect(pending).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_WORKER_FAILED, recoverable: true })
    session.close(1)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
