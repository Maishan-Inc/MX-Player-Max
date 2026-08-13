import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes, type DemuxPacket, type EngineError } from '@mx-player-max/types'
import {
  DecoderWorkerController,
  WorkerDecoderAdapter,
  type DecoderAdapterCallbacks,
  type DecoderAdapterLike,
  type DecoderWorkerRequest,
  type DecoderWorkerResponse,
  type DecoderWorkerTransport,
} from '../src/index'

interface TestConfig { kind: 'test'; supported: boolean }

const errors = {
  aborted: ErrorCodes.WEBCODECS_ABORTED,
  configInvalid: ErrorCodes.WEBCODECS_CONFIG_INVALID,
  configureFailed: ErrorCodes.WEBCODECS_CONFIGURE_FAILED,
  decodeFailed: ErrorCodes.WEBCODECS_DECODE_FAILED,
  flushFailed: ErrorCodes.WEBCODECS_FLUSH_FAILED,
  resetFailed: ErrorCodes.WEBCODECS_RESET_FAILED,
  workerFailed: ErrorCodes.WEBCODECS_WORKER_FAILED,
  frameInvalid: ErrorCodes.WEBCODECS_FRAME_INVALID,
} as const

class FakeAdapter implements DecoderAdapterLike<TestConfig> {
  decodeQueueSize = 0
  readonly configure = vi.fn(async (_config: TestConfig, _epoch: number) => {})
  readonly decode = vi.fn((_packet: DemuxPacket, _epoch: number) => { this.decodeQueueSize += 1 })
  readonly flush = vi.fn(async (_epoch: number) => {})
  readonly reset = vi.fn(async (_epoch: number) => { this.decodeQueueSize = 0 })
  readonly close = vi.fn()
}

class FakeTransport implements DecoderWorkerTransport<TestConfig> {
  readonly requests: DecoderWorkerRequest<TestConfig>[] = []
  listener: ((event: MessageEvent<DecoderWorkerResponse>) => void) | null = null
  readonly terminate = vi.fn()
  postMessage(message: DecoderWorkerRequest<TestConfig>): void { this.requests.push(message) }
  addEventListener(_type: 'message', listener: (event: MessageEvent<DecoderWorkerResponse>) => void): void { this.listener = listener }
  removeEventListener(): void { this.listener = null }
  respond(response: DecoderWorkerResponse): void { this.listener?.({ data: response } as MessageEvent<DecoderWorkerResponse>) }
}

class FakeMessagePort extends FakeTransport {
  override readonly terminate = undefined
  readonly start = vi.fn()
  readonly close = vi.fn()
}

describe('Decoder Worker control plane', () => {
  it('configures, decodes and transfers VideoFrame without pixel conversion', async () => {
    const messages: DecoderWorkerResponse[] = []
    const transfers: Transferable[][] = []
    const fake = new FakeAdapter()
    let callbacks!: DecoderAdapterCallbacks
    const controller = createController({
      postMessage(message, transfer = []) { messages.push(message); transfers.push(transfer) },
    }, fake, (value) => { callbacks = value })
    await controller.handle(configure())
    await controller.handle({ command: 'decode', sessionId: 's', epoch: 0, requestId: 'd', packet: packet() })
    const frame = { timestamp: 0, duration: 33_333, close: vi.fn() } as unknown as VideoFrame
    callbacks.onFrame(frame, 0)
    expect(messages.map((message) => message.type)).toEqual(['configured', 'frame'])
    expect(transfers[1]).toEqual([frame])
    expect(messages[1]).toMatchObject({ type: 'frame', frame, timestamp: 0, duration: 33_333 })
  })

  it('drops and closes stale Worker frames', async () => {
    const fake = new FakeAdapter()
    let callbacks!: DecoderAdapterCallbacks
    const controller = createController({ postMessage: vi.fn() }, fake, (value) => { callbacks = value })
    await controller.handle(configure(2))
    const close = vi.fn()
    callbacks.onFrame({ timestamp: 0, duration: null, close } as unknown as VideoFrame, 1)
    expect(close).toHaveBeenCalledOnce()
  })

  it('sanitizes failures without exposing raw platform details', async () => {
    const messages: DecoderWorkerResponse[] = []
    const fake = new FakeAdapter()
    fake.configure.mockRejectedValueOnce(Object.assign(new Error('private'), { name: 'OperationError' }))
    await createController({ postMessage: (message) => messages.push(message) }, fake).handle(configure())
    expect(messages[0]).toMatchObject({ type: 'error', error: { code: ErrorCodes.WEBCODECS_CONFIGURE_FAILED } })
    expect(JSON.stringify(messages[0])).not.toContain('OperationError')
    expect(JSON.stringify(messages[0])).not.toContain('private')
  })

  it('covers flush, increasing-epoch reset, reconfigure and close responses', async () => {
    const messages: DecoderWorkerResponse[] = []
    const fake = new FakeAdapter()
    const controller = createController({ postMessage: (message) => messages.push(message) }, fake)
    await controller.handle(configure())
    await controller.handle({ command: 'flush', sessionId: 's', epoch: 0, requestId: 'f0' })
    await controller.handle({ command: 'reset', sessionId: 's', epoch: 1, requestId: 'r1' })
    await controller.handle(configure(1, 'c1'))
    await controller.handle({ command: 'close', sessionId: 's', epoch: 2, requestId: 'x2' })
    expect(messages.map((message) => message.type)).toEqual(['configured', 'flushed', 'reset', 'configured', 'closed'])
    expect(fake.reset).toHaveBeenCalledWith(1)
    expect(fake.configure).toHaveBeenCalledTimes(2)
    expect(fake.close).toHaveBeenCalledOnce()
  })

  it('matches main-side control responses and closes stale transferred frames', async () => {
    const transport = new FakeTransport()
    const onFrame = vi.fn()
    const adapter = createMainAdapter(transport, { onFrame, onError: vi.fn(), onDequeue: vi.fn() })
    const configured = adapter.configure({ kind: 'test', supported: true }, 3)
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
    const adapter = createMainAdapter(port, { onFrame: vi.fn(), onError: vi.fn(), onDequeue: vi.fn() })
    expect(port.start).toHaveBeenCalledOnce()
    adapter.close()
    expect(port.close).toHaveBeenCalledOnce()
  })
})

function createController(
  port: { postMessage(message: DecoderWorkerResponse, transfer?: Transferable[]): void },
  adapter: FakeAdapter,
  capture?: (callbacks: DecoderAdapterCallbacks) => void,
): DecoderWorkerController<TestConfig> {
  return new DecoderWorkerController(port, {
    createAdapter: (callbacks) => { capture?.(callbacks); return adapter },
    createError,
    errors,
  })
}

function createMainAdapter(transport: DecoderWorkerTransport<TestConfig>, callbacks: DecoderAdapterCallbacks): WorkerDecoderAdapter<TestConfig> {
  return new WorkerDecoderAdapter({ callbacks, config: { transportFactory: () => transport, createError, errors }, sessionId: 's' })
}

function createError(code: string, message: string, recoverable: boolean, _cause?: unknown): EngineError {
  return { code, message, recoverable }
}

function configure(epoch = 0, requestId = 'c'): DecoderWorkerRequest<TestConfig> {
  return { command: 'configure', sessionId: 's', epoch, requestId, config: { kind: 'test', supported: true } }
}

function packet(): DemuxPacket {
  return { trackId: 1, kind: 'video', timestamp: 0, duration: 33_333, keyframe: true, data: Uint8Array.of(1) }
}
