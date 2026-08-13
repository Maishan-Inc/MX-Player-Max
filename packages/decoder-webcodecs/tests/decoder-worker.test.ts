import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes, type DemuxPacket } from '@mx-player-max/types'
import {
  VideoDecoderWorkerController,
  WorkerVideoDecoderAdapter,
  type DecoderWorkerRequest,
  type DecoderWorkerResponse,
  type DecoderWorkerTransport,
  type VideoDecoderAdapterCallbacks,
  type VideoDecoderAdapterLike,
} from '../src/index'

class FakeAdapter implements VideoDecoderAdapterLike {
  decodeQueueSize = 0
  readonly configure = vi.fn(async () => {})
  readonly decode = vi.fn((_packet: DemuxPacket) => { this.decodeQueueSize += 1 })
  readonly flush = vi.fn(async () => {})
  readonly reset = vi.fn(async () => { this.decodeQueueSize = 0 })
  readonly close = vi.fn()
}

class FakeTransport implements DecoderWorkerTransport {
  readonly requests: DecoderWorkerRequest[] = []
  listener: ((event: MessageEvent<DecoderWorkerResponse>) => void) | null = null
  readonly terminate = vi.fn()
  postMessage(message: DecoderWorkerRequest): void { this.requests.push(message) }
  addEventListener(_type: 'message', listener: (event: MessageEvent<DecoderWorkerResponse>) => void): void { this.listener = listener }
  removeEventListener(): void { this.listener = null }
  respond(response: DecoderWorkerResponse): void { this.listener?.({ data: response } as MessageEvent<DecoderWorkerResponse>) }
}

class FakeMessagePort extends FakeTransport {
  override readonly terminate = undefined
  readonly start = vi.fn()
  readonly close = vi.fn()
}

describe('VideoDecoder Worker protocol', () => {
  it('configures, decodes and transfers VideoFrame without pixel conversion', async () => {
    const messages: DecoderWorkerResponse[] = []
    const transfers: Transferable[][] = []
    const fake = new FakeAdapter()
    let callbacks!: VideoDecoderAdapterCallbacks
    const controller = new VideoDecoderWorkerController({
      postMessage(message, transfer = []) { messages.push(message); transfers.push(transfer) },
    }, { createAdapter: (value) => { callbacks = value; return fake } })
    await controller.handle({ command: 'configure', sessionId: 's', epoch: 0, requestId: 'c', config: workerConfig() })
    await controller.handle({ command: 'decode', sessionId: 's', epoch: 0, requestId: 'd', packet: packet() })
    const frame = { timestamp: 0, duration: 33_333, close: vi.fn() } as unknown as VideoFrame
    callbacks.onFrame(frame, 0)
    expect(messages.map((message) => message.type)).toEqual(['configured', 'frame'])
    expect(transfers[1]).toEqual([frame])
    expect(messages[1]).toMatchObject({ type: 'frame', frame, timestamp: 0, duration: 33_333 })
  })

  it('drops and closes stale Worker frames', async () => {
    const fake = new FakeAdapter()
    let callbacks!: VideoDecoderAdapterCallbacks
    const controller = new VideoDecoderWorkerController({ postMessage: vi.fn() }, { createAdapter: (value) => { callbacks = value; return fake } })
    await controller.handle({ command: 'configure', sessionId: 's', epoch: 2, requestId: 'c', config: workerConfig() })
    const close = vi.fn()
    callbacks.onFrame({ timestamp: 0, duration: null, close } as unknown as VideoFrame, 1)
    expect(close).toHaveBeenCalledOnce()
  })

  it('maps Worker-side decoder failures without exposing browser exception names', async () => {
    const messages: DecoderWorkerResponse[] = []
    const fake = new FakeAdapter()
    fake.configure.mockRejectedValueOnce(Object.assign(new Error('private'), { name: 'OperationError' }))
    const controller = new VideoDecoderWorkerController({ postMessage: (message) => messages.push(message) }, { createAdapter: () => fake })
    await controller.handle({ command: 'configure', sessionId: 's', epoch: 0, requestId: 'c', config: workerConfig() })
    expect(messages[0]).toMatchObject({ type: 'error', error: { code: ErrorCodes.WEBCODECS_CONFIGURE_FAILED } })
    expect(JSON.stringify(messages[0])).not.toContain('OperationError')
  })

  it('reports a stable error when VideoDecoder cannot be created inside the Worker', async () => {
    const messages: DecoderWorkerResponse[] = []
    const controller = new VideoDecoderWorkerController(
      { postMessage: (message) => messages.push(message) },
      {
        createAdapter: () => {
          throw { code: ErrorCodes.WEBCODECS_API_UNAVAILABLE, message: 'VideoDecoder is unavailable', recoverable: false }
        },
      },
    )
    await expect(controller.handle({ command: 'configure', sessionId: 's', epoch: 0, requestId: 'c', config: workerConfig() })).resolves.toBeUndefined()
    expect(messages[0]).toMatchObject({
      type: 'error',
      sessionId: 's',
      epoch: 0,
      requestId: 'c',
      error: { code: ErrorCodes.WEBCODECS_API_UNAVAILABLE },
    })
  })

  it('covers flush, increasing-epoch reset, reconfigure and close responses', async () => {
    const messages: DecoderWorkerResponse[] = []
    const fake = new FakeAdapter()
    const controller = new VideoDecoderWorkerController({ postMessage: (message) => messages.push(message) }, { createAdapter: () => fake })
    await controller.handle({ command: 'configure', sessionId: 's', epoch: 0, requestId: 'c0', config: workerConfig() })
    await controller.handle({ command: 'flush', sessionId: 's', epoch: 0, requestId: 'f0' })
    await controller.handle({ command: 'reset', sessionId: 's', epoch: 1, requestId: 'r1' })
    await controller.handle({ command: 'configure', sessionId: 's', epoch: 1, requestId: 'c1', config: workerConfig() })
    await controller.handle({ command: 'close', sessionId: 's', epoch: 2, requestId: 'x2' })
    expect(messages.map((message) => message.type)).toEqual(['configured', 'flushed', 'reset', 'configured', 'closed'])
    expect(fake.reset).toHaveBeenCalledWith(1)
    expect(fake.configure).toHaveBeenCalledTimes(2)
    expect(fake.close).toHaveBeenCalledOnce()
  })

  it('matches main-side control responses and closes stale transferred frames', async () => {
    const transport = new FakeTransport()
    const onFrame = vi.fn()
    const adapter = new WorkerVideoDecoderAdapter({ callbacks: { onFrame, onError: vi.fn(), onDequeue: vi.fn() }, transportFactory: () => transport, sessionId: 's' })
    const configured = adapter.configure(config(), true, 3)
    const request = transport.requests[0]
    if (!request) throw new Error('missing request')
    transport.respond({ type: 'configured', sessionId: 's', epoch: 3, requestId: request.requestId })
    await configured
    const staleClose = vi.fn()
    transport.respond({ type: 'frame', sessionId: 's', epoch: 2, requestId: 'old', frame: { close: staleClose } as unknown as VideoFrame, timestamp: 0, duration: null })
    expect(staleClose).toHaveBeenCalledOnce()
    expect(onFrame).not.toHaveBeenCalled()
    adapter.close()
    expect(transport.terminate).toHaveBeenCalledOnce()
  })

  it('supports an injected MessagePort lifecycle without assuming Worker APIs', () => {
    const port = new FakeMessagePort()
    const adapter = new WorkerVideoDecoderAdapter({ callbacks: { onFrame: vi.fn(), onError: vi.fn(), onDequeue: vi.fn() }, transportFactory: () => port, sessionId: 'port' })
    expect(port.start).toHaveBeenCalledOnce()
    adapter.close()
    expect(port.close).toHaveBeenCalledOnce()
  })
})

function config(): VideoDecoderConfig { return { codec: 'vp8', codedWidth: 640, codedHeight: 360 } }
function workerConfig() { return { kind: 'webcodecs' as const, config: config(), supported: true } }
function packet(): DemuxPacket { return { trackId: 1, kind: 'video', timestamp: 0, duration: 33_333, keyframe: true, data: Uint8Array.of(1) } }
