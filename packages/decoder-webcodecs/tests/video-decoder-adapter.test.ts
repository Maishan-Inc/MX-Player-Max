import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes, type DemuxPacket } from '@mx-player-max/types'
import {
  VideoDecoderAdapter,
  type EncodedVideoChunkFactory,
  type VideoDecoderRuntime,
  type VideoDecoderRuntimeCallbacks,
} from '../src/index'

class FakeRuntime implements VideoDecoderRuntime {
  state: VideoDecoderRuntime['state'] = 'unconfigured'
  decodeQueueSize = 0
  readonly configure = vi.fn((_config: VideoDecoderConfig) => { this.state = 'configured' })
  readonly decode = vi.fn((_chunk: EncodedVideoChunk) => { this.decodeQueueSize += 1 })
  readonly flush = vi.fn(async () => {})
  readonly reset = vi.fn(() => { this.state = 'unconfigured'; this.decodeQueueSize = 0 })
  readonly close = vi.fn(() => { this.state = 'closed' })
}

function setup() {
  const runtime = new FakeRuntime()
  const runtimes = [runtime]
  let runtimeCalls = 0
  let callbacks!: VideoDecoderRuntimeCallbacks
  const onFrame = vi.fn()
  const onError = vi.fn()
  const onDequeue = vi.fn()
  const chunkFactory: EncodedVideoChunkFactory = { create: vi.fn((init) => init as unknown as EncodedVideoChunk) }
  const adapter = new VideoDecoderAdapter({
    callbacks: { onFrame, onError, onDequeue },
    runtimeFactory: (value) => {
      callbacks = value
      if (runtimeCalls === 0) { runtimeCalls += 1; return runtime }
      const next = new FakeRuntime()
      runtimes.push(next)
      runtimeCalls += 1
      return next
    },
    chunkFactory,
  })
  return { adapter, runtime, runtimes, callbacks, onFrame, onError, onDequeue, chunkFactory }
}

describe('VideoDecoderAdapter', () => {
  it('configures only verified complete configurations', async () => {
    const { adapter, runtime, runtimes } = setup()
    await adapter.configure(config(), true, 0)
    expect(runtime.configure).toHaveBeenCalledWith(config())
    await expect(adapter.configure(config(), false, 0)).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_NOT_SUPPORTED })
    await expect(adapter.configure({ codec: 'vp8' }, true, 0)).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_CONFIG_INVALID })
  })

  it('maps synchronous configure and decode failures', async () => {
    const first = setup()
    first.runtime.configure.mockImplementationOnce(() => { throw new Error('private configure detail') })
    await expect(first.adapter.configure(config(), true, 0)).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_CONFIGURE_FAILED })
    const second = setup()
    await second.adapter.configure(config(), true, 0)
    second.runtime.decode.mockImplementationOnce(() => { throw new Error('private decode detail') })
    expect(() => second.adapter.decode(packet(), 0)).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_DECODE_FAILED }))
  })

  it('decodes key/delta packets and exposes decodeQueueSize', async () => {
    const { adapter, runtime, chunkFactory } = setup()
    await adapter.configure(config(), true, 2)
    adapter.decode(packet({ keyframe: true }), 2)
    adapter.decode(packet({ keyframe: false }), 2)
    expect(runtime.decode).toHaveBeenCalledTimes(2)
    expect(chunkFactory.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'key' }))
    expect(chunkFactory.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'delta' }))
    expect(adapter.decodeQueueSize).toBe(2)
  })

  it('forwards output, decoder errors and dequeue notifications with the active epoch', async () => {
    const { adapter, callbacks, onFrame, onError, onDequeue } = setup()
    await adapter.configure(config(), true, 4)
    const frame = { close: vi.fn(), timestamp: 0, duration: null } as unknown as VideoFrame
    callbacks.output(frame)
    callbacks.dequeue()
    callbacks.error(new Error('private callback detail'))
    expect(onFrame).toHaveBeenCalledWith(frame, 4)
    expect(onDequeue).toHaveBeenCalledWith(4)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: ErrorCodes.WEBCODECS_DECODE_FAILED }), 4)
  })

  it('flushes, resets, and requires reconfiguration before decoding', async () => {
    const { adapter, runtime, runtimes } = setup()
    await adapter.configure(config(), true, 1)
    await adapter.flush(1)
    expect(runtime.flush).toHaveBeenCalledOnce()
    await adapter.reset(2)
    expect(runtime.reset).toHaveBeenCalledOnce()
    expect(() => adapter.decode(packet(), 2)).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_ABORTED }))
    await adapter.configure(config(), true, 2)
    adapter.decode(packet(), 2)
    expect(runtime.configure).toHaveBeenCalledOnce()
    expect(runtimes[1]?.configure).toHaveBeenCalledOnce()
  })

  it('maps flush and reset failures to stable errors', async () => {
    const first = setup()
    await first.adapter.configure(config(), true, 0)
    first.runtime.flush.mockRejectedValueOnce(new Error('flush'))
    await expect(first.adapter.flush(0)).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_FLUSH_FAILED })
    const second = setup()
    await second.adapter.configure(config(), true, 0)
    second.runtime.reset.mockImplementationOnce(() => { throw new Error('reset') })
    await expect(second.adapter.reset(1)).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_RESET_FAILED })
  })

  it('closes idempotently, closes late frames and rejects later operations', async () => {
    const { adapter, runtime, callbacks } = setup()
    await adapter.configure(config(), true, 0)
    adapter.close()
    adapter.close()
    const close = vi.fn()
    callbacks.output({ close } as unknown as VideoFrame)
    expect(runtime.close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    await expect(adapter.flush(0)).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_ABORTED })
    expect(() => adapter.decode(packet(), 0)).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_ABORTED }))
  })

  it('closes late output and ignores errors from the runtime generation replaced by reset', async () => {
    const { adapter, callbacks: oldCallbacks, onError } = setup()
    await adapter.configure(config(), true, 0)
    await adapter.reset(1)
    await adapter.configure(config(), true, 1)
    const close = vi.fn()
    oldCallbacks.output({ close } as unknown as VideoFrame)
    oldCallbacks.error(new Error('old generation'))
    expect(close).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    adapter.close()
  })
})

function config(): VideoDecoderConfig {
  return { codec: 'vp8', codedWidth: 640, codedHeight: 360 }
}

function packet(overrides: Partial<DemuxPacket> = {}): DemuxPacket {
  return { trackId: 1, kind: 'video', timestamp: 0, duration: null, keyframe: true, data: Uint8Array.of(1), ...overrides }
}
